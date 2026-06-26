import { recordExports, resolveModule, lookupExport, ensureScanned } from "./manifest.ts";

const CTX = "__vanilla_ctx";

const CTX_APIS = new Set([
  "h",
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
  "useTransition",
  "startTransition",
  "isTransitioning",
]);

const FRAMEWORK_SOURCES = new Set(["vanilla-bean", "vanilla-bean/jotai"]);

export default function ctxPlugin({ types: t }: { types: any }, options: any = {}): any {
  const scan = !!options.scan;
  const mode = options.mode || "b";
  const isCap = (n?: string): boolean => !!n && /^[A-Z]/.test(n);

  const ensureParam = (fn: any): void => {
    const p = fn.params;
    if (p.length && t.isIdentifier(p[0]) && p[0].name === CTX) return;
    p.unshift(t.identifier(CTX));
  };
  const refsCtx = (path: any): boolean => {
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
  const prependCtx = (call: any): void => {
    const a0 = call.arguments[0];
    if (a0 && t.isIdentifier(a0) && a0.name === CTX) return;
    call.arguments.unshift(t.identifier(CTX));
  };

  return {
    name: "framework:ctx",
    visitor: {
      Program: {
        exit(path: any, state: any) {
          const filename: string = state?.file?.opts?.filename || "";
          const ctxLocals = new Set<string>(["h"]);
          for (const stmt of path.node.body) {
            if (t.isImportDeclaration(stmt) && FRAMEWORK_SOURCES.has(stmt.source.value)) {
              for (const s of stmt.specifiers) {
                if (t.isImportSpecifier(s)) {
                  const imp = t.isIdentifier(s.imported) ? s.imported.name : s.imported.value;
                  if (CTX_APIS.has(imp)) ctxLocals.add(s.local.name);
                }
              }
            }
          }

          path.traverse({
            CallExpression(p: any) {
              const c = p.node.callee;
              if (t.isIdentifier(c) && ctxLocals.has(c.name)) prependCtx(p.node);
            },
          });

          const resolveImportedCall = (binding: any): "ctx" | "plain" | "unknown" => {
            const ip = binding.path;
            if (!ip || !ip.parentPath?.node?.source) return "unknown";
            let importedName: string;
            if (typeof ip.isImportSpecifier === "function" && ip.isImportSpecifier()) {
              importedName = t.isIdentifier(ip.node.imported) ? ip.node.imported.name : ip.node.imported.value;
            } else if (typeof ip.isImportDefaultSpecifier === "function" && ip.isImportDefaultSpecifier()) {
              importedName = "default";
            } else {
              return "unknown";
            }
            const source: string = ip.parentPath.node.source.value;
            if (FRAMEWORK_SOURCES.has(source)) return "unknown";
            if (!source.startsWith(".")) return "plain";
            if (!filename) return "unknown";
            const target = resolveModule(filename, source);
            if (!target) return "unknown";
            ensureScanned(target, mode);
            return lookupExport(mode, target, importedName);
          };

          let usedCall = false;
          path.traverse({
            CallExpression(p: any) {
              const c = p.node.callee;
              if (!t.isIdentifier(c) || ctxLocals.has(c.name) || !/^use[A-Z]/.test(c.name)) return;
              const binding = p.scope.getBinding(c.name);
              if (!binding || binding.kind !== "module") return;
              const decision = resolveImportedCall(binding);
              if (decision === "plain") return;
              if (decision === "ctx") {
                prependCtx(p.node);
                return;
              }
              p.replaceWith(
                t.callExpression(t.identifier("__call"), [
                  t.identifier(CTX),
                  t.identifier(c.name),
                  ...p.node.arguments,
                ]),
              );
              usedCall = true;
            },
          });

          type Info = { path: any; node: any; name?: string; componentish: boolean; exported: boolean };
          const fns = new Map<any, Info>();
          const calledNames = new Set<string>();
          const hTags = new Set<string>();

          const add = (p: any, name: string | undefined, componentish: boolean, exported: boolean): void => {
            let info = fns.get(p.node);
            if (!info) {
              info = { path: p, node: p.node, name, componentish, exported };
              fns.set(p.node, info);
            }
            if (name && !info.name) info.name = name;
            info.componentish ||= componentish;
            info.exported ||= exported;
          };

          path.traverse({
            CallExpression(p: any) {
              const c = p.node.callee;
              if (t.isIdentifier(c)) calledNames.add(c.name);
              if (t.isIdentifier(c, { name: "h" })) {
                const tag = p.node.arguments[1];
                if (t.isIdentifier(tag)) hTags.add(tag.name);
              }
              if (t.isIdentifier(c, { name: "__mark" })) {
                const fn = p.get("arguments.0");
                if (fn.node && (t.isFunctionExpression(fn.node) || t.isArrowFunctionExpression(fn.node)))
                  add(fn, undefined, true, false);
              }
            },
            FunctionDeclaration(p: any) {
              const exported = t.isExportNamedDeclaration(p.parent) || t.isExportDefaultDeclaration(p.parent);
              add(p, p.node.id?.name, t.isExportDefaultDeclaration(p.parent), exported);
            },
            VariableDeclarator(p: any) {
              const init = p.get("init");
              if (!t.isIdentifier(p.node.id) || !init.node) return;
              if (!t.isArrowFunctionExpression(init.node) && !t.isFunctionExpression(init.node)) return;
              const exported = t.isExportNamedDeclaration(p.parentPath?.parent);
              add(init, p.node.id.name, false, exported);
            },
            ExportDefaultDeclaration(p: any) {
              const d = p.get("declaration");
              if (d.node && (t.isArrowFunctionExpression(d.node) || t.isFunctionExpression(d.node)))
                add(d, undefined, true, true);
            },
            AssignmentExpression(p: any) {
              const l = p.node.left;
              if (!t.isMemberExpression(l) || !t.isIdentifier(l.property, { name: "fallback" })) return;
              const r = p.get("right");
              if (r.node && (t.isFunctionExpression(r.node) || t.isArrowFunctionExpression(r.node)))
                add(r, undefined, true, false);
            },
          });

          for (const info of fns.values()) {
            if (info.name && hTags.has(info.name)) info.componentish = true;
          }
          const moduleScope = new Map<Info, boolean>();
          const directly = new Map<Info, boolean>();
          const callees = new Map<Info, Set<string>>();
          for (const info of fns.values()) {
            moduleScope.set(info, !info.path.getFunctionParent());
            directly.set(info, refsCtx(info.path));
            const set = new Set<string>();
            info.path.traverse({
              CallExpression(p: any) {
                const c = p.node.callee;
                if (t.isIdentifier(c)) set.add(c.name);
              },
            });
            callees.set(info, set);
          }
          void calledNames;

          const inject = new Set<Info>();
          for (const info of fns.values()) {
            const componentish = info.componentish || (info.exported && directly.get(info));
            if (componentish || (moduleScope.get(info) && directly.get(info))) inject.add(info);
          }
          let changed = true;
          while (changed) {
            changed = false;
            const names = new Set([...inject].map((i) => i.name).filter(Boolean) as string[]);
            for (const info of fns.values()) {
              if (inject.has(info) || !moduleScope.get(info)) continue;
              for (const callee of callees.get(info)!) {
                if (names.has(callee)) {
                  inject.add(info);
                  changed = true;
                  break;
                }
              }
            }
          }

          const injNames = new Set([...inject].map((i) => i.name).filter(Boolean) as string[]);

          if (filename) {
            const ctxExports = new Set<string>();
            const knownExports = new Set<string>();
            let defaultCtx = false;
            let defaultKnown = false;
            const fnInjected = (node: any): boolean | null => {
              const info = fns.get(node);
              return info ? inject.has(info) : null;
            };
            const bindingFn = (name: string): any => {
              const b = path.scope.getBinding(name);
              const n = b?.path?.node;
              if (!n) return null;
              if (t.isFunctionDeclaration(n)) return n;
              if (t.isVariableDeclarator(n) && n.init) return n.init;
              return null;
            };
            const classify = (name: string, node: any): void => {
              const v = fnInjected(node);
              if (v === null) return;
              knownExports.add(name);
              if (v) ctxExports.add(name);
            };
            for (const stmt of path.node.body) {
              if (t.isExportNamedDeclaration(stmt)) {
                if (t.isFunctionDeclaration(stmt.declaration) && stmt.declaration.id) {
                  classify(stmt.declaration.id.name, stmt.declaration);
                } else if (t.isVariableDeclaration(stmt.declaration)) {
                  for (const d of stmt.declaration.declarations)
                    if (t.isIdentifier(d.id) && d.init) classify(d.id.name, d.init);
                } else if (!stmt.declaration && stmt.specifiers && !stmt.source) {
                  for (const s of stmt.specifiers) {
                    if (!t.isExportSpecifier(s)) continue;
                    const node = bindingFn(s.local.name);
                    if (node) classify(t.isIdentifier(s.exported) ? s.exported.name : s.exported.value, node);
                  }
                }
              } else if (t.isExportDefaultDeclaration(stmt)) {
                const d: any = stmt.declaration;
                const node =
                  t.isFunctionDeclaration(d) || t.isArrowFunctionExpression(d) || t.isFunctionExpression(d)
                    ? d
                    : t.isIdentifier(d)
                      ? bindingFn(d.name)
                      : null;
                const v = node ? fnInjected(node) : null;
                if (v !== null) {
                  defaultKnown = true;
                  if (v) defaultCtx = true;
                }
              }
            }
            recordExports(mode, filename, { ctx: ctxExports, known: knownExports, defaultCtx, defaultKnown });
          }
          if (scan) return;

          for (const info of inject) {
            ensureParam(info.node);
            if (info.name) {
              const brand = t.expressionStatement(
                t.assignmentExpression(
                  "=",
                  t.memberExpression(t.identifier(info.name), t.identifier("__vbctx")),
                  t.numericLiteral(1),
                ),
              );
              const stmt = info.path.getStatementParent();
              if (stmt) stmt.insertAfter(brand);
            }
          }

          path.traverse({
            CallExpression(p: any) {
              const c = p.node.callee;
              if (t.isIdentifier(c) && injNames.has(c.name)) prependCtx(p.node);
            },
          });

          const inCtxScope = (p: any): boolean => {
            let fp = p.getFunctionParent();
            while (fp) {
              if (inject.has(fns.get(fp.node)!)) return true;
              fp = fp.getFunctionParent();
            }
            return false;
          };
          const HELPERS = new Set(["__use", "__call", "h", "__mark"]);
          const isWrapArg = (p: any): boolean => {
            if (p.listKey !== "arguments") return false;
            const call = p.parentPath;
            if (!call.isCallExpression()) return false;
            const callee = call.node.callee;
            if (t.isIdentifier(callee) && HELPERS.has(callee.name)) return false;
            if (t.isIdentifier(callee, { name: "h" }) && p.key === 1) return false;
            return inCtxScope(p);
          };

          let usedUse = false;
          path.traverse({
            Identifier(p: any) {
              if (p.node.name === CTX || !isCap(p.node.name) || !isWrapArg(p)) return;
              p.replaceWith(t.callExpression(t.identifier("__use"), [t.identifier(CTX), t.identifier(p.node.name)]));
              usedUse = true;
            },
            MemberExpression(p: any) {
              if (!t.isIdentifier(p.node.property) || !isCap(p.node.property.name) || !isWrapArg(p)) return;
              p.replaceWith(t.callExpression(t.identifier("__use"), [t.identifier(CTX), p.node]));
              p.skip();
              usedUse = true;
            },
          });

          const isNamespaceImport = (p: any, name: string): boolean => {
            const b = p.scope.getBinding(name);
            return (
              !!b &&
              !!b.path &&
              typeof b.path.isImportNamespaceSpecifier === "function" &&
              b.path.isImportNamespaceSpecifier()
            );
          };
          path.traverse({
            CallExpression(p: any) {
              const c = p.node.callee;
              if (t.isIdentifier(c)) {
                if (ctxLocals.has(c.name) || HELPERS.has(c.name)) return;
                const binding = p.scope.getBinding(c.name);
                if (!binding || binding.kind !== "module" || !inCtxScope(p)) return;
                const decision = resolveImportedCall(binding);
                if (decision === "ctx") {
                  prependCtx(p.node);
                  p.skip();
                  return;
                }
                if (decision === "plain") {
                  p.skip();
                  return;
                }
                p.replaceWith(
                  t.callExpression(t.identifier("__call"), [
                    t.identifier(CTX),
                    t.identifier(c.name),
                    ...p.node.arguments,
                  ]),
                );
                p.skip();
                usedCall = true;
                return;
              }
              if (!t.isMemberExpression(c) || c.computed || !t.isIdentifier(c.object) || !t.isIdentifier(c.property))
                return;
              if (!inCtxScope(p)) return;
              if (isNamespaceImport(p, c.object.name)) {
                p.replaceWith(t.callExpression(t.identifier("__call"), [t.identifier(CTX), c, ...p.node.arguments]));
                p.skip();
                usedCall = true;
                return;
              }
              const ob = p.scope.getBinding(c.object.name);
              if (ob && ob.kind === "module" && /^use[A-Z]/.test(c.property.name)) {
                throw p.buildCodeFrameError(
                  `[vanilla-bean] ${c.object.name}.${c.property.name}() can't be given a render context (member calls keep their receiver). ` +
                    `Import the hook directly instead: import { ${c.property.name} } from "…".`,
                );
              }
            },
          });

          const helpers = [usedUse ? "__use" : "", usedCall ? "__call" : ""].filter((n) => n);
          if (helpers.length) {
            path.node.body.unshift(
              t.importDeclaration(
                helpers.map((n) => t.importSpecifier(t.identifier(n), t.identifier(n))),
                t.stringLiteral("vanilla-bean"),
              ),
            );
          }

          path.traverse({
            Identifier(p: any) {
              if (p.node.name === CTX && !p.getFunctionParent()) {
                throw p.buildCodeFrameError(
                  "[vanilla-bean] a render-context API (a signal read, effect, cookies, …) is used at module scope, " +
                    "where there is no render context. Move it inside a component. " +
                    "(Creating a signal at module scope is fine, `const x = signal(0)` but reading it must be inside a component.)",
                );
              }
            },
          });
        },
      },
    },
  };
}
