const CTX = "__vanilla_ctx";

const CTX_APIS = new Set([
  "h",
  "signal",
  "makeSignal",
  "effect",
  "derived",
  "onCleanup",
  "useLocation",
  "cookies",
  "redirect",
  "getRequest",
  "headers",
  "setHeader",
  "useAtom",
  "useAtomValue",
  "useSetAtom",
  "trackAsync",
  "untrackAsync",
  "trackServer",
]);

const FRAMEWORK_SOURCES = new Set(["vanilla-bean", "vanilla-bean/jotai"]);

export default function ctxPlugin({ types: t }: { types: any }): any {
  const isComponentName = (name?: string): boolean => !!name && /^[A-Z]/.test(name);

  const ensureCtxParam = (fn: any): void => {
    const params = fn.params;
    if (params.length && t.isIdentifier(params[0]) && params[0].name === CTX) return;
    params.unshift(t.identifier(CTX));
  };

  const referencesCtx = (path: any): boolean => {
    let found = false;
    path.traverse({
      Identifier(p: any) {
        if (p.node.name === CTX) {
          found = true;
          p.stop();
        }
      },
    });
    return found;
  };

  return {
    name: "framework:ctx",
    visitor: {
      Program: {
        exit(path: any) {
          const ctxLocals = new Set<string>(["h"]);
          for (const stmt of path.node.body) {
            if (t.isImportDeclaration(stmt) && FRAMEWORK_SOURCES.has(stmt.source.value)) {
              for (const spec of stmt.specifiers) {
                if (t.isImportSpecifier(spec)) {
                  const imported = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
                  if (CTX_APIS.has(imported)) ctxLocals.add(spec.local.name);
                }
              }
            }
          }
          path.traverse({
            CallExpression(p: any) {
              const callee = p.node.callee;
              if (!t.isIdentifier(callee) || !ctxLocals.has(callee.name)) return;
              const first = p.node.arguments[0];
              if (first && t.isIdentifier(first) && first.name === CTX) return;
              p.node.arguments.unshift(t.identifier(CTX));
            },
          });
          const components = new Set<string>();
          const inject = (fnPath: any, name?: string): void => {
            if (!referencesCtx(fnPath)) return;
            ensureCtxParam(fnPath.node);
            if (name && isComponentName(name)) components.add(name);
          };

          path.traverse({
            FunctionDeclaration(p: any) {
              const name = p.node.id?.name;
              const exported = t.isExportNamedDeclaration(p.parent) || t.isExportDefaultDeclaration(p.parent);
              if (isComponentName(name) || exported) inject(p, name);
            },
            VariableDeclarator(p: any) {
              const init = p.get("init");
              const name = t.isIdentifier(p.node.id) ? p.node.id.name : undefined;
              const exported = t.isExportNamedDeclaration(p.parentPath?.parent);
              if (
                name &&
                (isComponentName(name) || exported) &&
                init.node &&
                (t.isArrowFunctionExpression(init.node) || t.isFunctionExpression(init.node))
              ) {
                inject(init, name);
              }
            },
            ExportDefaultDeclaration(p: any) {
              const d = p.get("declaration");
              if (
                d.node &&
                (t.isFunctionDeclaration(d.node) ||
                  t.isArrowFunctionExpression(d.node) ||
                  t.isFunctionExpression(d.node))
              ) {
                ensureCtxParam(d.node);
              }
            },
            CallExpression(p: any) {
              if (!t.isIdentifier(p.node.callee, { name: "__mark" })) return;
              const fn = p.get("arguments.0");
              if (fn.node && (t.isFunctionExpression(fn.node) || t.isArrowFunctionExpression(fn.node)))
                ensureCtxParam(fn.node);
            },
            AssignmentExpression(p: any) {
              const left = p.node.left;
              if (!t.isMemberExpression(left) || !t.isIdentifier(left.property, { name: "fallback" })) return;
              const r = p.get("right");
              if (r.node && (t.isFunctionExpression(r.node) || t.isArrowFunctionExpression(r.node)))
                ensureCtxParam(r.node);
            },
          });
          let usedUse = false;
          path.traverse({
            Identifier(p: any) {
              if (!components.has(p.node.name) || p.listKey !== "arguments") return;
              const call = p.parentPath;
              if (!call.isCallExpression()) return;
              const callee = call.node.callee;
              if (t.isIdentifier(callee, { name: "__use" })) return;
              if (t.isIdentifier(callee, { name: "h" }) && p.key === 1) return;
              p.replaceWith(t.callExpression(t.identifier("__use"), [t.identifier(CTX), t.identifier(p.node.name)]));
              usedUse = true;
            },
          });

          if (usedUse) {
            path.node.body.unshift(
              t.importDeclaration(
                [t.importSpecifier(t.identifier("__use"), t.identifier("__use"))],
                t.stringLiteral("vanilla-bean"),
              ),
            );
          }
        },
      },
    },
  };
}
