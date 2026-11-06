const jsxName = (node) =>
  node.type === "JSXElement" && node.openingElement.name.type === "JSXIdentifier"
    ? node.openingElement.name.name
    : null;

export default {
  meta: { name: "repo" },
  rules: {
    "no-nested-breadcrumb-separator": {
      create(context) {
        return {
          JSXElement(node) {
            if (jsxName(node) !== "BreadcrumbSeparator") return;
            for (let p = node.parent; p; p = p.parent) {
              if (jsxName(p) !== "BreadcrumbItem") continue;
              context.report({
                node,
                message:
                  "R5b: BreadcrumbSeparator renders an <li>, so inside BreadcrumbItem it nests an <li> in an <li> (40a8092, e017985). Make it a sibling of the items: <BreadcrumbItem>...</BreadcrumbItem><BreadcrumbSeparator />.",
              });
              return;
            }
          },
        };
      },
    },
  },
};
