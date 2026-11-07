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

const LIST_PARTS = new Set(["li", "BreadcrumbItem", "BreadcrumbList", "BreadcrumbSeparator"]);

const renderedElements = (node) => {
  switch (node?.type) {
    case "JSXElement":
      return [node];
    case "JSXFragment":
      return node.children.flatMap(renderedElements);
    case "JSXExpressionContainer":
    case "ParenthesizedExpression":
      return renderedElements(node.expression);
    case "LogicalExpression":
      return renderedElements(node.right);
    case "ConditionalExpression":
      return [...renderedElements(node.consequent), ...renderedElements(node.alternate)];
    case "ArrayExpression":
      return node.elements.flatMap(renderedElements);
    case "CallExpression":
      return node.arguments.flatMap(renderedElements);
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return node.body.type === "BlockStatement"
        ? node.body.body.flatMap((s) =>
            s.type === "ReturnStatement" ? renderedElements(s.argument) : [],
          )
        : renderedElements(node.body);
    default:
      return [];
  }
};

const CASTS = new Set(["TSAsExpression", "TSTypeAssertion"]);

const unparenthesized = (node) =>
  node.type === "ParenthesizedExpression" ? unparenthesized(node.expression) : node;

const DOUBLE_CAST_MESSAGE =
  "R6: a cast through unknown compiles any shape, so a wrong stored value surfaces later as a wrong value. Use packages/agent/src/durable-json.ts: `durableMemo(key, schema)` to read and keep a task memo, `parseStored(key, value, schema)` for a document field, `toJson(value)` to store one. For anything else, type it so it compiles: a typed list, a `Pick` of the api.";

const NEVER_CAST_MESSAGE =
  "R6b: `as never` fits any parameter, so a wrong shape compiles. Parse durable JSON with packages/agent/src/durable-json.ts, or give the value its real type: erase a generic to `unknown` (`GateHooks<unknown>`), brand an id (`as ConversationId`), or `as const` a literal.";

const RAW_ENV_MESSAGE =
  "R3: read the validated env, not process.env. In the app call `appEnv()` from apps/web/src/server/env.ts, or read `env` from @groot/core/env, and add the key to that schema if it is missing. Packages take the env as a parameter from the app.";

const TRANSACTION_MESSAGE =
  "R7: no transactions in packages/ (AGENTS.md). Use one statement with RETURNING, a compare-and-set update (WHERE on the expected old value), or an idempotent retry. An app that needs a transaction runs a sync db.transaction() in apps/ and passes the tx in.";

// `db` and `tx` by name, plus anything imported from the database module or
// drizzle, or typed with a type from there.
const DB_NAMES = ["db", "tx"];
const DATABASE_MODULE = /(^|\/)database(\/index)?(\.[cm]?[jt]s)?$|^drizzle-orm(\/|$)/;

const SESSION_INVALID_NAMES = new Set(["sessionInvalid", "SESSION_INVALID"]);
const SESSION_INVALID_MESSAGE =
  "R9: only the session guard throws sessionInvalid() or sets the SESSION_INVALID code, because the client signs the owner out on it. For a wrong password, passkey or other credential failure, throw a plain Boom.unauthorized.";

export default {
  meta: { name: "repo" },
  rules: {
    "no-restricted-require": {
      meta: { schema: [{ type: "object" }] },
      create(context) {
        const { regex, message } = context.options[0];
        const restricted = new RegExp(regex);
        return {
          CallExpression(node) {
            const [source] = node.arguments;
            if (
              node.callee.type === "Identifier" &&
              node.callee.name === "require" &&
              source?.type === "Literal" &&
              restricted.test(String(source.value))
            )
              context.report({ node, message });
          },
        };
      },
    },
    "no-package-transaction": {
      create(context) {
        const dbNames = new Set(DB_NAMES);
        const isDb = (node) => {
          const target = unparenthesized(node);
          if (target.type === "Identifier") return dbNames.has(target.name);
          return (
            target.type === "MemberExpression" &&
            !target.computed &&
            DB_NAMES.includes(target.property.name)
          );
        };
        const isDbType = (type) =>
          (type?.type === "TSTypeReference" &&
            type.typeName.type === "Identifier" &&
            dbNames.has(type.typeName.name)) ||
          (type?.type === "TSTypeQuery" && isDb(type.exprName));
        return {
          ImportDeclaration(node) {
            if (!DATABASE_MODULE.test(node.source.value)) return;
            for (const s of node.specifiers) dbNames.add(s.local.name);
          },
          Identifier(node) {
            if (isDbType(node.typeAnnotation?.typeAnnotation)) dbNames.add(node.name);
          },
          VariableDeclarator(node) {
            if (node.id.type === "Identifier" && node.init && isDb(node.init)) {
              dbNames.add(node.id.name);
            }
          },
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== "MemberExpression") return;
            const name = callee.computed ? callee.property.value : callee.property.name;
            if (name === "transaction" && isDb(callee.object)) {
              context.report({ node, message: TRANSACTION_MESSAGE });
            }
          },
        };
      },
    },
    "no-session-invalid": {
      create(context) {
        const reported = new Set();
        const report = (node) => {
          if (reported.has(node.start)) return;
          reported.add(node.start);
          context.report({ node, message: SESSION_INVALID_MESSAGE });
        };
        return {
          Identifier(node) {
            if (SESSION_INVALID_NAMES.has(node.name)) report(node);
          },
          Literal(node) {
            if (SESSION_INVALID_NAMES.has(node.value)) report(node);
          },
          TemplateElement(node) {
            if (SESSION_INVALID_NAMES.has(node.value.cooked)) report(node);
          },
        };
      },
    },
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
    "no-double-cast": {
      create(context) {
        const check = (node) => {
          const inner = unparenthesized(node.expression);
          if (!CASTS.has(inner.type)) return;
          const through = inner.typeAnnotation.type;
          if (through === "TSUnknownKeyword" || through === "TSAnyKeyword") {
            context.report({ node, message: DOUBLE_CAST_MESSAGE });
          }
        };
        return { TSAsExpression: check, TSTypeAssertion: check };
      },
    },
    "no-never-cast": {
      create(context) {
        const check = (node) => {
          if (node.typeAnnotation.type === "TSNeverKeyword") {
            context.report({ node, message: NEVER_CAST_MESSAGE });
          }
        };
        return { TSAsExpression: check, TSTypeAssertion: check };
      },
    },
    "breadcrumbs-children": {
      create(context) {
        return {
          JSXElement(node) {
            if (jsxName(node) !== "Breadcrumbs") return;
            const page = node.openingElement.attributes.find(
              (a) => a.type === "JSXAttribute" && a.name.name === "page",
            );
            for (const el of [...node.children, page?.value].flatMap(renderedElements)) {
              if (!LIST_PARTS.has(jsxName(el))) continue;
              context.report({
                node: el,
                message: `R5c: Breadcrumbs renders each crumb in its own <li> and places the separators, so <${jsxName(el)}> inside it nests an <li> in an <li>. Pass the link or button itself: <Breadcrumbs page="Current"><Link to="/parent">Parent</Link></Breadcrumbs>.`,
              });
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
