const REACTIVE_SOURCES = new Set(["useLocation"]);
const FACTORIES = new Set(["signal"]);
const CTX = "__vanilla_ctx";

export default function signals({ types: t }: any): any {
  const get = (name: string) => t.callExpression(t.identifier(name), [t.identifier(CTX)]);
  const set = (name: string, val: any) => t.callExpression(t.identifier(name), [t.identifier(CTX), val]);

  function rewriteSignal(p: any): void {
    const { node } = p;
    if (!t.isIdentifier(node.id) || !node.init) return;
    if (!t.isCallExpression(node.init) || !t.isIdentifier(node.init.callee) || !FACTORIES.has(node.init.callee.name))
      return;
    const name = node.id.name;
    const binding = p.scope.getBinding(name);
    if (!binding) return;

    for (const ref of binding.referencePaths) {
      const parent = ref.parentPath;
      if (parent.isCallExpression() && parent.node.callee === ref.node) {
        const args = parent.node.arguments;
        if (!(t.isIdentifier(args[0]) && args[0].name === CTX)) args.unshift(t.identifier(CTX));
        ref.skip();
        continue;
      }
      if (parent.isAssignmentExpression() && parent.node.left === ref.node) continue;
      if (parent.isUpdateExpression()) continue;
      if (parent.isReturnStatement()) continue;
      ref.replaceWith(get(name));
      ref.skip();
    }

    for (const v of binding.constantViolations) {
      if (v.isAssignmentExpression() && t.isIdentifier(v.node.left, { name })) {
        const op = v.node.operator;
        const val = op === "=" ? v.node.right : t.binaryExpression(op.slice(0, -1), get(name), v.node.right);
        v.replaceWith(set(name, val));
      } else if (v.isUpdateExpression() && t.isIdentifier(v.node.argument, { name })) {
        v.replaceWith(
          set(name, t.binaryExpression(v.node.operator === "++" ? "+" : "-", get(name), t.numericLiteral(1))),
        );
      }
    }
  }

  function rewriteDestructure(p: any): void {
    const { node } = p;
    if (!t.isObjectPattern(node.id) || !t.isCallExpression(node.init)) return;
    const callee = node.init.callee;
    if (!t.isIdentifier(callee) || !REACTIVE_SOURCES.has(callee.name)) return;
    for (const prop of node.id.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.value) || !t.isIdentifier(prop.key)) continue;
      const binding = p.scope.getBinding(prop.value.name);
      if (!binding) continue;
      for (const ref of binding.referencePaths) {
        ref.replaceWith(t.memberExpression(t.callExpression(t.cloneNode(callee), []), t.identifier(prop.key.name)));
        ref.skip();
      }
    }
  }

  return {
    name: "framework-signals",
    visitor: {
      VariableDeclarator(path: any) {
        rewriteSignal(path);
        rewriteDestructure(path);
      },
    },
  };
}
