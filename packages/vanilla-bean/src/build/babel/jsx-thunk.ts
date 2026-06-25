export default function thunkPlugin({ types: t }: any): any {
  const isStatic = (node: any): boolean =>
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isJSXElement(node) ||
    t.isJSXFragment(node) ||
    t.isArrowFunctionExpression(node) ||
    t.isFunctionExpression(node);

  const wrap = (node: any) => t.arrowFunctionExpression([], node);
  const lazy = (node: any) => t.jsxExpressionContainer(t.arrowFunctionExpression([], node));
  const dyn = (node: any) => t.callExpression(t.identifier("__dyn"), [wrap(node)]);

  const LAZY_CHILDREN = new Set(["Suspense", "ErrorBoundary"]);

  const wrapElementChildren = (node: any): void => {
    node.children = node.children.map((c: any) => (t.isJSXElement(c) || t.isJSXFragment(c) ? lazy(c) : c));
  };

  return {
    name: "jsx-thunk",
    visitor: {
      JSXElement(path: any) {
        const name = path.node.openingElement.name;
        if (t.isJSXIdentifier(name) && LAZY_CHILDREN.has(name.name)) {
          const kids = path.node.children;
          const meaningful = kids.filter((c: any) => !(t.isJSXText(c) && !c.value.trim()));
          if (meaningful.length === 0) return;
          if (meaningful.length === 1 && t.isJSXExpressionContainer(meaningful[0])) {
            const e = meaningful[0].expression;
            if (t.isArrowFunctionExpression(e) || t.isFunctionExpression(e)) return;
          }
          const frag = t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), kids);
          path.node.children = [t.jsxExpressionContainer(t.arrowFunctionExpression([], frag))];
          return;
        }
        wrapElementChildren(path.node);
      },

      JSXFragment(path: any) {
        wrapElementChildren(path.node);
      },

      JSXExpressionContainer(path: any) {
        const expr = path.node.expression;
        if (t.isJSXEmptyExpression(expr)) return;

        const parent = path.parent;

        if (t.isJSXAttribute(parent)) {
          const name = parent.name && parent.name.name;
          if (typeof name === "string" && /^on[A-Z]/.test(name)) return;
          if (isStatic(expr)) return;
          path.node.expression = wrap(expr);
          return;
        }

        if (t.isJSXElement(parent) || t.isJSXFragment(parent)) {
          if (t.isJSXElement(expr) || t.isJSXFragment(expr)) {
            path.node.expression = wrap(expr);
            return;
          }
          if (isStatic(expr)) return;
          if (t.isIdentifier(expr, { name: "children" })) {
            path.node.expression = wrap(expr);
            return;
          }
          path.node.expression = dyn(expr);
        }
      },
    },
  };
}
