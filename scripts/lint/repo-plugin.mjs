const jsxName = (node) =>
  node.type === "JSXElement" && node.openingElement.name.type === "JSXIdentifier"
    ? node.openingElement.name.name
    : null;

const isProcess = (node) =>
  (node.type === "Identifier" && node.name === "process") ||
  (node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    node.object.name === "globalThis" &&
    node.property.name === "process");

const isEnvKey = (key, computed) =>
  computed
    ? key.type === "Literal" && key.value === "env"
    : key.type === "Identifier" && key.name === "env";

const RAW_ENV_MESSAGE =
  "R3: read the validated env, not process.env. In the app call `appEnv()` from apps/web/src/server/env.ts, or read `env` from @groot/core/env, and add the key to that schema if it is missing. Packages take the env as a parameter from the app.";

export default {
  meta: { name: "repo" },
  rules: {
    "no-raw-env": {
      create(context) {
        const report = (node) => context.report({ node, message: RAW_ENV_MESSAGE });
        return {
          MemberExpression(node) {
            if (isEnvKey(node.property, node.computed) && isProcess(node.object)) report(node);
          },
          VariableDeclarator(node) {
            if (
              node.id.type === "ObjectPattern" &&
              node.init &&
              isProcess(node.init) &&
              node.id.properties.some((p) => p.type === "Property" && isEnvKey(p.key, p.computed))
            )
              report(node);
          },
          ImportDeclaration(node) {
            if (node.source.value !== "node:process" && node.source.value !== "process") return;
            for (const s of node.specifiers) {
              if (s.type === "ImportSpecifier" && s.imported.name === "env") report(s);
            }
          },
        };
      },
    },
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
