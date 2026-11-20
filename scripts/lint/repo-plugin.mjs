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

const LOAD_IN_EFFECT_MESSAGE =
  "R15: load request/response data with useResource from apps/web/src/client/queries/resource.ts (writes: useMutation), not a fetch in useEffect. A hand-rolled load needs its own cancel flag, busy reset and refresh after a change, and agents kept missing one (issue #412). A live stream or socket is not a resource: list the file in R15's except in scripts/lint/boundaries.ts with the reason.";

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);

// useEffect(...) or React.useEffect(...).
const isEffectCall = (node) => {
  if (node?.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier") return EFFECT_HOOKS.has(callee.name);
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    EFFECT_HOOKS.has(callee.property.name)
  );
};

// fetch(...) or someApi.method(...): the client's request helpers are named *Api.
const isLoadCall = (node) => {
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name === "fetch";
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name.endsWith("Api")
  );
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
// drizzle, typed with a type from there, or a function that returns one.
const DB_NAMES = ["db", "tx"];
const DATABASE_MODULE = /(^|\/)database(\/index)?(\.[cm]?[jt]s)?$|^drizzle-orm(\/|$)/;

const SESSION_INVALID_NAMES = new Set(["sessionInvalid", "SESSION_INVALID"]);
const SESSION_INVALID_MESSAGE =
  "R9: only the session guard (packages/core/src/session/index.ts) throws sessionInvalid() or sets the SESSION_INVALID code, because the client signs the owner out on it. For a wrong password, passkey or other credential failure, throw a plain Boom.unauthorized.";

// Typed in the source, not written as an escape: an escape is the opt-out.
const EM_DASH = "\u2014";
const EM_DASH_MESSAGE =
  'R10: no em dash in UI copy: it reads as machine-written. Use a period, colon, comma or parentheses, and "-" for an empty value. If one is really needed (a quoted title, a typographic convention), write it as \\u2014.';

const staticString = (node, lookup) => {
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? node.value : null;
    case "Identifier":
      return lookup(node);
    case "ParenthesizedExpression":
      return staticString(node.expression, lookup);
    case "BinaryExpression": {
      if (node.operator !== "+") return null;
      const left = staticString(node.left, lookup);
      const right = staticString(node.right, lookup);
      return left === null || right === null ? null : left + right;
    }
    case "TemplateLiteral": {
      let text = node.quasis[0].value.cooked;
      for (const [i, expression] of node.expressions.entries()) {
        const piece = staticString(expression, lookup);
        if (piece === null) return null;
        text += piece + node.quasis[i + 1].value.cooked;
      }
      return text;
    }
    default:
      return null;
  }
};

const MODULE_SCOPES = new Set(["module", "global"]);

const MODULE_STATE_MESSAGE =
  "R12: module state belongs in the App root (apps/web/src/server/app-root.ts); see docs/rewrite/DECISIONS.md D8";

const COLLECTIONS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

const API_TYPE_EXPORT_MESSAGE =
  "R13: an API's request and response types live once, in apps/web/src/shared/api/<area>.ts, where the server's handlers use them too (docs/rewrite/README.md §4.5). Declare the type there and import it here; its other readers import it from there as well.";

const TYPE_DECLARATIONS = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration"]);

const WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

const unwrapped = (node) => (WRAPPERS.has(node.type) ? unwrapped(node.expression) : node);

const isCollection = (node) => {
  const target = node && unwrapped(node);
  return (
    target?.type === "NewExpression" &&
    target.callee.type === "Identifier" &&
    COLLECTIONS.has(target.callee.name)
  );
};

/** The names a declarator binds: `a`, or each name in `{ a, b: [c] }`. */
const boundNames = (pattern) => {
  switch (pattern?.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((p) =>
        boundNames(p.type === "RestElement" ? p.argument : p.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap(boundNames);
    case "RestElement":
      return boundNames(pattern.argument);
    case "AssignmentPattern":
      return boundNames(pattern.left);
    default:
      return [];
  }
};

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

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
    "no-module-state": {
      meta: { schema: [{ type: "object" }] },
      create(context) {
        const file = context.filename.replaceAll("\\", "/");
        const allowed = new Set(
          (context.options[0]?.allow ?? []).flatMap((entry) => {
            const at = entry.lastIndexOf(":");
            return file === entry.slice(0, at) || file.endsWith(`/${entry.slice(0, at)}`)
              ? [entry.slice(at + 1)]
              : [];
          }),
        );
        return {
          VariableDeclaration(node) {
            const parent =
              node.parent.type === "ExportNamedDeclaration" ? node.parent.parent : node.parent;
            if (parent.type !== "Program") return;
            for (const declarator of node.declarations) {
              if (node.kind === "const" && !isCollection(declarator.init)) continue;
              if (boundNames(declarator.id).every((name) => allowed.has(name))) continue;
              context.report({ node: declarator, message: MODULE_STATE_MESSAGE });
            }
          },
        };
      },
    },
    "no-api-type-exports": {
      create(context) {
        const report = (node) => context.report({ node, message: API_TYPE_EXPORT_MESSAGE });
        return {
          ExportNamedDeclaration(node) {
            if (node.declaration) {
              if (TYPE_DECLARATIONS.has(node.declaration.type)) report(node);
              return;
            }
            if (node.exportKind === "type") return report(node);
            for (const specifier of node.specifiers) {
              if (specifier.exportKind === "type") report(specifier);
            }
          },
          ExportAllDeclaration(node) {
            if (node.exportKind === "type") report(node);
          },
        };
      },
    },
    "no-package-transaction": {
      create(context) {
        const dbNames = new Set(DB_NAMES);
        const isDb = (node) => {
          const target = unparenthesized(node);
          switch (target.type) {
            case "Identifier":
              return dbNames.has(target.name);
            case "MemberExpression":
              return !target.computed && DB_NAMES.includes(target.property.name);
            case "CallExpression":
              return isDb(target.callee);
            default:
              return false;
          }
        };
        const isDbType = (type) =>
          (type?.type === "TSTypeReference" &&
            type.typeName.type === "Identifier" &&
            dbNames.has(type.typeName.name)) ||
          (type?.type === "TSTypeQuery" && isDb(type.exprName));
        const returnsDb = (fn) =>
          fn.body.type === "BlockStatement"
            ? fn.body.body.some(
                (s) => s.type === "ReturnStatement" && s.argument && isDb(s.argument),
              )
            : isDb(fn.body);
        return {
          ImportDeclaration(node) {
            if (!DATABASE_MODULE.test(node.source.value)) return;
            for (const s of node.specifiers) dbNames.add(s.local.name);
          },
          Identifier(node) {
            if (isDbType(node.typeAnnotation?.typeAnnotation)) dbNames.add(node.name);
          },
          VariableDeclarator(node) {
            if (
              node.id.type === "Identifier" &&
              node.init &&
              (isDb(node.init) || (FUNCTIONS.has(node.init.type) && returnsDb(node.init)))
            ) {
              dbNames.add(node.id.name);
            }
            if (node.id.type !== "ObjectPattern") return;
            for (const p of node.id.properties) {
              if (
                p.type === "Property" &&
                !p.computed &&
                DB_NAMES.includes(p.key.name) &&
                p.value.type === "Identifier"
              )
                dbNames.add(p.value.name);
            }
          },
          AssignmentExpression(node) {
            if (node.left.type === "Identifier" && isDb(node.right)) dbNames.add(node.left.name);
          },
          FunctionDeclaration(node) {
            if (node.id && returnsDb(node)) dbNames.add(node.id.name);
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
        const consts = new Map();
        const lookup = (id) => {
          if (!consts.has(id.name)) return null;
          for (let scope = context.sourceCode.getScope(id); scope; scope = scope.upper) {
            if (!scope.set.has(id.name)) continue;
            return MODULE_SCOPES.has(scope.type) ? consts.get(id.name) : null;
          }
          return null;
        };
        const check = (node) => {
          if (SESSION_INVALID_NAMES.has(staticString(node, lookup))) report(node);
        };
        return {
          Identifier(node) {
            if (SESSION_INVALID_NAMES.has(node.name)) report(node);
          },
          VariableDeclarator(node) {
            const declaration = node.parent;
            const topLevel =
              declaration.parent.type === "Program" ||
              declaration.parent.type === "ExportNamedDeclaration";
            if (declaration.kind !== "const" || !topLevel) return;
            if (node.id.type !== "Identifier" || !node.init) return;
            const value = staticString(node.init, lookup);
            if (value !== null) consts.set(node.id.name, value);
          },
          Literal: check,
          TemplateLiteral: check,
          BinaryExpression: check,
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
    "no-em-dash-copy": {
      create(context) {
        const check = (node, raw) => {
          if (raw.includes(EM_DASH)) context.report({ node, message: EM_DASH_MESSAGE });
        };
        return {
          Literal: (node) => typeof node.value === "string" && check(node, node.raw),
          TemplateElement: (node) => check(node, node.value.raw),
          JSXText: (node) => check(node, node.raw ?? node.value),
        };
      },
    },
    "no-load-in-effect": {
      create(context) {
        // Loads outside an effect, by the name of the const holding them, so
        // `const load = useCallback(() => api.list())` then `useEffect(load)` counts.
        const held = [];
        const effectNames = new Set();
        const isFunction = (n) =>
          n?.type === "ArrowFunctionExpression" ||
          n?.type === "FunctionExpression" ||
          (n?.type === "CallExpression" &&
            n.callee.type === "Identifier" &&
            n.callee.name === "useCallback");
        const holderNames = (node) => {
          const names = [];
          for (let p = node.parent; p; p = p.parent) {
            if (p.type === "FunctionDeclaration" && p.id) names.push(p.id.name);
            if (
              p.type === "VariableDeclarator" &&
              p.id.type === "Identifier" &&
              isFunction(p.init)
            ) {
              names.push(p.id.name);
            }
          }
          return names;
        };
        // Names an effect runs: the effect itself (`useEffect(load)`), what it
        // calls (`load()`), and what it hands on (`setInterval(load)`). A key or
        // property that only spells the same name does not count.
        const collectNames = (node) => {
          if (!node || typeof node.type !== "string") return;
          if (node.type === "Identifier") effectNames.add(node.name);
          if (node.type === "CallExpression") {
            for (const part of [node.callee, ...node.arguments]) {
              if (part.type === "Identifier") effectNames.add(part.name);
            }
          }
          for (const key of Object.keys(node)) {
            if (key === "parent") continue;
            const value = node[key];
            if (Array.isArray(value)) value.forEach(walkEffect);
            else if (value && typeof value === "object") walkEffect(value);
          }
        };
        const walkEffect = (node) => {
          if (!node || typeof node.type !== "string" || node.type === "Identifier") return;
          collectNames(node);
        };
        return {
          CallExpression(node) {
            if (isEffectCall(node)) {
              collectNames(node.arguments[0]);
              return;
            }
            if (!isLoadCall(node)) return;
            for (let p = node.parent; p; p = p.parent) {
              if (isEffectCall(p)) {
                context.report({ node, message: LOAD_IN_EFFECT_MESSAGE });
                return;
              }
            }
            held.push({ node, names: holderNames(node) });
          },
          "Program:exit"() {
            for (const { node, names } of held) {
              if (names.some((n) => effectNames.has(n))) {
                context.report({ node, message: LOAD_IN_EFFECT_MESSAGE });
              }
            }
          },
        };
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
