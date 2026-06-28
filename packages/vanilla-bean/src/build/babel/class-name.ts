export default function className({ types: t }: any): any {
  return {
    name: "class-name",
    visitor: {
      JSXOpeningElement(path: any) {
        const name = path.node.name;
        if (!t.isJSXIdentifier(name) || name.name !== name.name.toLowerCase()) return;

        for (const attr of path.node.attributes) {
          if (!t.isJSXAttribute(attr)) continue;
          if (t.isJSXIdentifier(attr.name, { name: "className" })) attr.name = t.jsxIdentifier("class");
        }
      },
    },
  };
}
