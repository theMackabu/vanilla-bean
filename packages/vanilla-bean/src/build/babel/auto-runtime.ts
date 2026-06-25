export default function autoJsxRuntime({ types: t }: any, options: any = {}): any {
  const source = options.source || "vanilla-bean";
  const NAMES = ["h", "Fragment", "__static", "__mark", "__dyn"];
  return {
    name: "auto-jsx-runtime",
    visitor: {
      Program: {
        exit(path: any) {
          path.scope.crawl();
          const missing = NAMES.filter((n) => path.scope.globals[n] && !path.scope.hasBinding(n));
          if (!missing.length) return;
          path.unshiftContainer(
            "body",
            t.importDeclaration(
              missing.map((n: string) => t.importSpecifier(t.identifier(n), t.identifier(n))),
              t.stringLiteral(source),
            ),
          );
        },
      },
    },
  };
}
