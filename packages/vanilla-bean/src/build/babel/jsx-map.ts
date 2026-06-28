export default function jsxMap({ types: t }: any): any {
  const warned = new Set<string>();

  const isMapCall = (node: any): boolean =>
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.property, { name: "map" });

  const keyExprOf = (attr: any): any => {
    if (!attr.value) return t.booleanLiteral(true);
    if (t.isStringLiteral(attr.value)) return t.stringLiteral(attr.value.value);
    if (t.isJSXExpressionContainer(attr.value)) return attr.value.expression;
    return null;
  };

  const takeKey = (node: any): any => {
    if (!t.isJSXElement(node)) return null;
    const attrs = node.openingElement.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name, { name: "key" })) continue;
      attrs.splice(i, 1);
      return keyExprOf(attr);
    }
    return null;
  };

  const keyFromReturn = (body: any): any => {
    let found: any = null;
    if (t.isJSXElement(body)) return takeKey(body);
    if (t.isBlockStatement(body)) {
      for (const stmt of body.body) {
        if (!t.isReturnStatement(stmt) || !stmt.argument) continue;
        found = takeKey(stmt.argument);
        if (found) break;
      }
    }
    return found;
  };

  const warnMissingKey = (state: any): void => {
    const file = state.file?.opts?.filename || "<unknown>";
    if (warned.has(file)) return;
    warned.add(file);
    if (process.env.NODE_ENV === "production") return;
    console.warn(`[vanilla-bean] JSX .map() in ${file} has no key prop; using item identity/index fallback.`);
  };

  return {
    name: "jsx-map",
    visitor: {
      JSXExpressionContainer(path: any, state: any) {
        const expr = path.node.expression;
        if (!isMapCall(expr)) return;
        if (!t.isJSXElement(path.parent) && !t.isJSXFragment(path.parent)) return;

        const render = expr.arguments[0];
        if (!t.isArrowFunctionExpression(render) && !t.isFunctionExpression(render)) return;

        const item = t.isIdentifier(render.params[0]) ? t.cloneNode(render.params[0]) : t.identifier("item");
        const index = t.isIdentifier(render.params[1]) ? t.cloneNode(render.params[1]) : t.identifier("index");
        let key = keyFromReturn(render.body);
        let keyParams = render.params.map((param: any) => t.cloneNode(param));
        if (!key) {
          warnMissingKey(state);
          keyParams = [t.cloneNode(item), t.cloneNode(index)];
          key = t.logicalExpression("??", t.cloneNode(item), t.cloneNode(index));
        }

        const keyFn = t.arrowFunctionExpression(keyParams, key);
        path.node.expression = t.jsxElement(
          t.jsxOpeningElement(t.jsxIdentifier("For"), [
            t.jsxAttribute(t.jsxIdentifier("each"), t.jsxExpressionContainer(t.cloneNode(expr.callee.object))),
            t.jsxAttribute(t.jsxIdentifier("key"), t.jsxExpressionContainer(keyFn)),
          ]),
          t.jsxClosingElement(t.jsxIdentifier("For")),
          [t.jsxExpressionContainer(render)],
        );
      },
    },
  };
}
