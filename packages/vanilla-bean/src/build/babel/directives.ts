import path from "node:path";

const MODES: Record<string, string> = {
  "use client": "client",
  "use static": "static",
  "use server": "server",
};

function hashKey(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return "s" + (h >>> 0).toString(36);
}

export default function directives({ types: t }: any, opts: any = {}): any {
  const isServerBuild = !!opts.server;
  const isBrowser = !!opts.browser;
  const rel = (state: any) => path.relative(process.cwd(), state.file.opts.filename || "?");
  const importFrom = (name: string) =>
    t.importDeclaration([t.importSpecifier(t.identifier(name), t.identifier(name))], t.stringLiteral("vanilla-bean"));

  function handleUseServer(p: any, state: any): void {
    const file = rel(state);
    const id = (name: string) => hashKey(`${file}:${name}`);
    const names: string[] = [];
    for (const stmt of p.node.body) {
      if (!t.isExportNamedDeclaration(stmt) || !stmt.declaration) continue;
      const decl = stmt.declaration;
      if (t.isFunctionDeclaration(decl) && decl.id) names.push(decl.id.name);
      else if (t.isVariableDeclaration(decl))
        for (const d of decl.declarations) if (t.isIdentifier(d.id)) names.push(d.id.name);
    }

    if (isServerBuild) {
      const regs = names.map((n) =>
        t.expressionStatement(t.callExpression(t.identifier("__register"), [t.stringLiteral(id(n)), t.identifier(n)])),
      );
      p.node.body.push(...regs);
      p.unshiftContainer("body", importFrom("__register"));
    } else {
      p.node.body = [
        importFrom("__action"),
        ...names.map((n) =>
          t.exportNamedDeclaration(
            t.variableDeclaration("const", [
              t.variableDeclarator(
                t.identifier(n),
                t.callExpression(t.identifier("__action"), [t.stringLiteral(id(n))]),
              ),
            ]),
            [],
          ),
        ),
      ];
    }
    p.node.directives = [];
  }

  const dirOf = (n: any) =>
    t.isBlockStatement(n.body) ? n.body.directives.find((d: any) => MODES[d.value.value]) || null : null;
  const toFnExpr = (n: any) =>
    t.isArrowFunctionExpression(n)
      ? t.arrowFunctionExpression(n.params, n.body, n.async)
      : t.functionExpression(n.id || null, n.params, n.body, n.generator, n.async);
  const containsJSX = (p: any): boolean => {
    let found = false;
    p.traverse({
      "JSXElement|JSXFragment"() {
        found = true;
      },
    });
    return found;
  };

  const wrappedByDirective = (p: any) =>
    p.parentPath?.isCallExpression?.() &&
    t.isIdentifier(p.parentPath.node.callee) &&
    (p.parentPath.node.callee.name === "__mark" || p.parentPath.node.callee.name === "__static");

  function handleFn(p: any, state: any): void {
    const n = p.node;
    const d = dirOf(n);
    const mode0 = d ? MODES[d.value.value] : state.fileMode;
    if (n.async && mode0 !== "server" && !wrappedByDirective(p) && containsJSX(p)) {
      throw p.buildCodeFrameError(
        'an async component must be marked "use server", a client cannot render an async component (it returns a Promise, not a node)',
      );
    }
    if (!d) return;
    n.body.directives = n.body.directives.filter((x: any) => x !== d);

    const mode = MODES[d.value.value];
    const key = hashKey(`${rel(state)}:${n.start}`);
    const isComponent = mode === "client" || mode === "server" || containsJSX(p);
    const fn = toFnExpr(n);
    const staticFn = isBrowser && !isComponent ? t.arrowFunctionExpression([], t.blockStatement([])) : fn;
    const stripServer = isBrowser && mode === "server";
    if (stripServer) state.serverStripped = true;
    const markFn = stripServer ? t.arrowFunctionExpression([], t.nullLiteral()) : fn;
    const replacement = isComponent
      ? t.callExpression(t.identifier("__mark"), [markFn, t.stringLiteral(mode), t.stringLiteral(key)])
      : t.callExpression(t.identifier("__static"), [t.stringLiteral(key), staticFn]);

    if (p.isFunctionDeclaration() && !p.parentPath.isExportDefaultDeclaration()) {
      p.replaceWith(t.variableDeclaration("const", [t.variableDeclarator(n.id, replacement)]));
    } else {
      p.replaceWith(replacement);
    }
  }

  return {
    name: "framework-directives",
    visitor: {
      Program: {
        enter(p: any, state: any) {
          const dirs = p.node.directives || [];
          if (dirs.some((x: any) => x.value.value === "use server")) {
            handleUseServer(p, state);
            return;
          }
          const d = dirs.find((x: any) => MODES[x.value.value]);
          if (!d) return;
          state.fileMode = MODES[d.value.value];
          state.fileKey = hashKey(`${rel(state)}:file`);
          p.node.directives = dirs.filter((x: any) => x !== d);
        },
        exit(p: any, state: any) {
          if (state.serverStripped)
            p.pushContainer("body", [
              t.exportNamedDeclaration(
                t.variableDeclaration("const", [
                  t.variableDeclarator(t.identifier("__serverRoute"), t.booleanLiteral(true)),
                ]),
                [],
              ),
            ]);
        },
      },
      FunctionDeclaration: handleFn,
      FunctionExpression: handleFn,
      ArrowFunctionExpression: handleFn,
      ExportDefaultDeclaration: {
        exit(p: any, state: any) {
          if (!state.fileMode) return;
          const decl = p.node.declaration;
          if (t.isCallExpression(decl)) {
            state.fileMode = null;
            return;
          }
          const mode = state.fileMode;
          const key = state.fileKey;
          state.fileMode = null;
          const mark = (arg: any) =>
            t.callExpression(t.identifier("__mark"), [arg, t.stringLiteral(mode), t.stringLiteral(key)]);
          if ((t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && decl.id) {
            p.replaceWithMultiple([decl, t.exportDefaultDeclaration(mark(t.cloneNode(decl.id)))]);
            return;
          }
          const expr = t.isFunctionDeclaration(decl)
            ? toFnExpr(decl)
            : t.isClassDeclaration(decl)
              ? t.classExpression(decl.id, decl.superClass, decl.body, decl.decorators || [])
              : decl;
          p.node.declaration = mark(expr);
        },
      },
    },
  };
}
