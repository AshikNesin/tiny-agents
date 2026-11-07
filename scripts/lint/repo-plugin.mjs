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
// drizzle, typed with a type from there, or a function that returns one.
const DB_NAMES = ["db", "tx"];
const DATABASE_MODULE = /(^|\/)database(\/index)?(\.[cm]?[jt]s)?$|^drizzle-orm(\/|$)/;

const SESSION_INVALID_NAMES = new Set(["sessionInvalid", "SESSION_INVALID"]);
const SESSION_INVALID_MESSAGE =
  "R9: only the session guard throws sessionInvalid() or sets the SESSION_INVALID code, because the client signs the owner out on it. For a wrong password, passkey or other credential failure, throw a plain Boom.unauthorized.";

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

const DEADLINE_LOOP_MESSAGE =
  "R10: tests freeze Date (tests/test-clock.ts), so Date.now() never moves past a deadline taken from it and this timeout can never be reached. Wait with `until(check, what, ms)` or `eventually(check, ms)` from tests/server/fixtures/until.ts, which time out on the real clock.";

const LOOPS = new Set([
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const COMPARISONS = new Set(["<", "<=", ">", ">="]);
const CLOCK_MOVERS = /^(advanceTimersByTime|advanceTimersToNextTimer|runAllTimers|setSystemTime)/;

const enclosingLoop = (node) => {
  for (let p = node.parent; p && !FUNCTIONS.has(p.type); p = p.parent) {
    if (LOOPS.has(p.type)) return p;
  }
  return null;
};

const isInside = (node, ancestor) => {
  for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
};

const movesClock = (node) =>
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "vi" &&
  CLOCK_MOVERS.test(node.callee.property.name);

const isDateNow = (node) =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "Date" &&
  node.callee.property.name === "now";

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
    // A comparison in a loop between a fresh Date.now() and a const taken from Date.now()
    // before the loop is constant under the frozen clock, whatever the loop's shape. A
    // retry loop capped by attempts also fires when its deadline comes from Date.now():
    // that timeout is dead too. Fake timers move Date, so a loop that drives them is exempt.
    "no-date-now-deadline-loop": {
      create(context) {
        const NOTHING = { now: false, deadline: false };
        const constDeclarator = (id) => {
          for (let scope = context.sourceCode.getScope(id); scope; scope = scope.upper) {
            const variable = scope.set.get(id.name);
            if (!variable) continue;
            const [def] = variable.defs;
            return def?.type === "Variable" && def.parent?.kind === "const" && def.node.init
              ? def.node
              : null;
          }
          return null;
        };
        // `now`: reads a Date.now() taken inside the loop. `deadline`: reads a const taken
        // from Date.now() before the loop.
        const reads = (node, loop, seen) => {
          const target = unparenthesized(node);
          if (isDateNow(target)) return { now: true, deadline: false };
          switch (target.type) {
            case "BinaryExpression": {
              const left = reads(target.left, loop, seen);
              const right = reads(target.right, loop, seen);
              return { now: left.now || right.now, deadline: left.deadline || right.deadline };
            }
            case "UnaryExpression":
              return reads(target.argument, loop, seen);
            case "Identifier": {
              const declarator = constDeclarator(target);
              if (!declarator || seen.has(declarator)) return NOTHING;
              seen.add(declarator);
              const init = reads(declarator.init, loop, seen);
              if (isInside(declarator, loop)) return init;
              return { now: false, deadline: init.now || init.deadline };
            }
            default:
              return NOTHING;
          }
        };
        const comparisons = [];
        const movers = [];
        return {
          CallExpression(node) {
            if (movesClock(node)) movers.push(node);
          },
          BinaryExpression(node) {
            if (!COMPARISONS.has(node.operator)) return;
            const loop = enclosingLoop(node);
            if (!loop) return;
            const { now, deadline } = reads(node, loop, new Set());
            if (now && deadline) comparisons.push({ node, loop });
          },
          "Program:exit"() {
            for (const { node, loop } of comparisons) {
              if (!movers.some((mover) => isInside(mover, loop))) {
                context.report({ node, message: DEADLINE_LOOP_MESSAGE });
              }
            }
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
