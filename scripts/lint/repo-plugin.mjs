import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_PATH, isGenerated, isKeptComment } from "./comments.mjs";

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
  "R15: load request/response data with useResource from apps/web/src/client/queries/resource.ts (writes: useMutation), not a fetch, an `xxxApi.` call or a `load…`/`fetch…` helper in useEffect. A hand-rolled load needs its own cancel flag, busy reset and refresh after a change, and agents kept missing one (issue #412). A live stream or socket is not a resource: list the file in R15's except in scripts/lint/boundaries.ts with the reason.";

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);

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

const isLoadCall = (node) => {
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name === "fetch";
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name.endsWith("Api")
  );
};

const LOADER_NAME = /^(load|fetch)[A-Z]/;

const loaderName = (node) => {
  const callee = node.callee;
  if (callee.type === "Identifier") return LOADER_NAME.test(callee.name) ? callee.name : null;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return LOADER_NAME.test(callee.property.name) ? callee.property.name : null;
  }
  return null;
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

const DB_NAMES = ["db", "tx"];
const DATABASE_MODULE = /(^|\/)database(\/index)?(\.[cm]?[jt]s)?$|^drizzle-orm(\/|$)/;

const SESSION_INVALID_NAMES = new Set(["sessionInvalid", "SESSION_INVALID"]);
const SESSION_INVALID_MESSAGE =
  "R9: only the session guard (packages/core/src/session/index.ts) throws sessionInvalid() or sets the SESSION_INVALID code, because the client signs the owner out on it. For a wrong password, passkey or other credential failure, throw a plain Boom.unauthorized.";

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

const NO_COMMENTS_MESSAGE =
  "R16: code carries no comments (ADR 0028). Say it in a name, a type or a test; record a decision in docs/adr/. The ratchet in scripts/lint/comment-baseline.json lets old comments stay until they go, and only shrinks.";

const baselines = new Map();

const allowedBy = (baselinePath) => (cwd, file) => {
  const key = `${cwd}\0${baselinePath}`;
  if (!baselines.has(key)) {
    const baseline = path.join(cwd, baselinePath);
    baselines.set(key, existsSync(baseline) ? JSON.parse(readFileSync(baseline, "utf8")) : {});
  }
  return baselines.get(key)[path.relative(cwd, file).replaceAll("\\", "/")] ?? 0;
};

const allowedComments = allowedBy(BASELINE_PATH);

export const SILENT_FALLBACK_BASELINE = "scripts/lint/silent-fallback-baseline.json";

const fallbackBaselines = new Map();

const allowedSilentFallbacks = (cwd, file) => {
  if (!fallbackBaselines.has(cwd)) {
    const baseline = path.join(cwd, SILENT_FALLBACK_BASELINE);
    fallbackBaselines.set(
      cwd,
      existsSync(baseline) ? JSON.parse(readFileSync(baseline, "utf8")) : {},
    );
  }
  return fallbackBaselines.get(cwd)[path.relative(cwd, file).replaceAll("\\", "/")] ?? {};
};

export const fallbackSite = (text) => text.replace(/\s+/g, " ").trim();

const SILENT_FALLBACK_MESSAGE =
  "R17: this drops the error and carries on as if the call worked. Agents shipped this three times: a DNS lookup failure let the browser through (#445), an auto-dismiss failure left a question pending (#469), and a slow `chromium --version` sent a HeadlessChrome user agent (#494). Handle the failure, rethrow it, or catch into a function whose name says why ignoring it is safe (`.catch(ignoreClosedSocket)`).";

const isFunction = (node) =>
  node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";

const ignoresError = (handler) =>
  isFunction(handler) &&
  handler.params.every((param) => param.type === "Identifier" && param.name.startsWith("_"));

const calledMethod = (node) =>
  node.callee.type === "MemberExpression" && !node.callee.computed
    ? node.callee.property.name
    : null;

const silentFallbacks = (node, text) => {
  if (node.type === "CatchClause") {
    return node.body.body.length === 0 ? [{ node, site: "catch {}" }] : [];
  }
  if (node.type !== "CallExpression") return [];
  const method = calledMethod(node);
  const handler =
    method === "catch" ? node.arguments[0] : method === "then" ? node.arguments[1] : undefined;
  return ignoresError(handler)
    ? [{ node: handler, site: fallbackSite(`.${method}(${text(handler)})`) }]
    : [];
};

const RACE_MESSAGE =
  "R19: another request can insert between this read and the insert below it, because an `await` sits between them. Agents shipped this race four times in e511da5 (task idempotency key, skill name, passkey register, singleton jobs). Put a unique index on the key and insert with `.onConflictDoNothing()` or `.onConflictDoUpdate()`, then read the row back; or do the read and the insert in one sync `db.transaction()` in apps/.";

const READ_METHODS = new Set(["findFirst", "findMany"]);

const readTable = (node) => {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return null;
  const { object, property, computed } = node.callee;
  if (computed) return null;
  if (property.name === "from" && node.arguments[0]?.type === "Identifier") {
    return node.arguments[0].name;
  }
  if (
    READ_METHODS.has(property.name) &&
    object.type === "MemberExpression" &&
    !object.computed &&
    object.object.type === "MemberExpression" &&
    !object.object.computed &&
    object.object.property.name === "query"
  ) {
    return object.property.name;
  }
  return null;
};

const guardedByConflict = (call) => {
  for (let node = call; node.parent; node = node.parent) {
    const { parent } = node;
    if (parent.type === "MemberExpression" && parent.object === node) {
      if (!parent.computed && parent.property.name.startsWith("onConflict")) return true;
    } else if (!(parent.type === "CallExpression" && parent.callee === node)) {
      return false;
    }
  }
  return false;
};

const insertTable = (node) =>
  node.type === "CallExpression" &&
  calledMethod(node) === "insert" &&
  node.arguments.length === 1 &&
  node.arguments[0].type === "Identifier" &&
  !guardedByConflict(node)
    ? node.arguments[0].name
    : null;

const MODULE_SCOPES = new Set(["module", "global"]);

const MODULE_STATE_MESSAGE =
  "R12: module state belongs in the App root (apps/web/src/server/app-root.ts): add a field to App and read it through app(). A constant lookup is declared `const NAME: ReadonlySet<T> = new Set([...])` (or ReadonlyMap).";

const COLLECTIONS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);
const READONLY_COLLECTIONS = new Set(["ReadonlySet", "ReadonlyMap"]);

const declaredReadonly = (id) =>
  READONLY_COLLECTIONS.has(id?.typeAnnotation?.typeAnnotation?.typeName?.name);

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

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

const FIRST_PARTY_MOCK_MESSAGE =
  "R21: fake the network with fakeApi() from tests/client/fakes/api.ts and render the real module; a mocked first-party module skips the envelope, the error mapping and the real `*-api.ts`, store or component, so the test passes whether or not they work (docs/guides/testing.md). Only a third-party package, or a transport jsdom cannot run that R21's allow in scripts/lint/boundaries.ts lists, is mocked.";

const FIRST_PARTY_SPECIFIER = /^(@\/|@groot\/|@tiny-agents\/|\.)/;
const CLIENT_ALIAS = "@/";
const CLIENT_ROOT = "/apps/web/src/client/";

const mockAllowed = (specifier, allow) =>
  allow.some(
    (entry) =>
      specifier === entry ||
      (specifier.startsWith(".") &&
        entry.startsWith(CLIENT_ALIAS) &&
        specifier.endsWith(CLIENT_ROOT + entry.slice(CLIENT_ALIAS.length))),
  );

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
    "no-first-party-mock": {
      meta: { schema: [{ type: "object" }] },
      create(context) {
        const allow = context.options[0]?.allow ?? [];
        const firstParty = (specifier) =>
          typeof specifier === "string" &&
          FIRST_PARTY_SPECIFIER.test(specifier) &&
          !mockAllowed(specifier, allow);
        const imported = new Set();
        const viCall = (node) =>
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "vi" &&
          node.callee.property.type === "Identifier"
            ? node.callee.property.name
            : undefined;
        const rootName = (node) => {
          let root = node;
          while (root?.type === "MemberExpression") root = root.object;
          return root?.type === "Identifier" ? root.name : undefined;
        };
        return {
          ImportDeclaration(node) {
            if (node.importKind === "type" || !firstParty(node.source.value)) return;
            for (const specifier of node.specifiers) {
              if (specifier.importKind !== "type") imported.add(specifier.local.name);
            }
          },
          CallExpression(node) {
            const called = viCall(node);
            const [target] = node.arguments;
            const mocksModule =
              (called === "mock" || called === "doMock") &&
              target?.type === "Literal" &&
              firstParty(target.value);
            const spiesOnImport = called === "spyOn" && imported.has(rootName(target));
            if (mocksModule || spiesOnImport) {
              context.report({ node, message: FIRST_PARTY_MOCK_MESSAGE });
            }
          },
        };
      },
    },
    "no-module-state": {
      create(context) {
        return {
          VariableDeclaration(node) {
            const parent =
              node.parent.type === "ExportNamedDeclaration" ? node.parent.parent : node.parent;
            if (parent.type !== "Program") return;
            for (const declarator of node.declarations) {
              if (node.kind === "const" && !isCollection(declarator.init)) continue;
              if (node.kind === "const" && declaredReadonly(declarator.id)) continue;
              context.report({ node: declarator, message: MODULE_STATE_MESSAGE });
            }
          },
        };
      },
    },
    "no-comments": {
      create(context) {
        return {
          Program() {
            if (isGenerated(context.sourceCode.text)) return;
            const comments = context.sourceCode
              .getAllComments()
              .filter((comment) => comment.type !== "Shebang" && !isKeptComment(comment.value));
            const allowed = allowedComments(context.cwd ?? process.cwd(), context.filename);
            for (const comment of comments.slice(allowed)) {
              context.report({ loc: comment.loc, message: NO_COMMENTS_MESSAGE });
            }
          },
        };
      },
    },
    "no-silent-fallback": {
      create(context) {
        const found = [];
        const text = (node) => context.sourceCode.getText(node);
        const collect = (node) => found.push(...silentFallbacks(node, text));
        return {
          CatchClause: collect,
          CallExpression: collect,
          "Program:exit"(program) {
            const allowed = allowedSilentFallbacks(context.cwd ?? process.cwd(), context.filename);
            const seen = new Map();
            for (const { node, site } of found) {
              const count = (seen.get(site) ?? 0) + 1;
              seen.set(site, count);
              if (count > (allowed[site] ?? 0)) {
                context.report({ node, message: `${SILENT_FALLBACK_MESSAGE} Site: \`${site}\`` });
              }
            }
            for (const [site, count] of Object.entries(allowed)) {
              if ((seen.get(site) ?? 0) < count) {
                context.report({
                  node: program,
                  message: `R17: ${SILENT_FALLBACK_BASELINE} allows ${count} of \`${site}\` here but the file has ${seen.get(site) ?? 0}. Lower or delete that entry to lock in the cut; the baseline only shrinks.`,
                });
              }
            }
          },
        };
      },
    },
    "no-check-then-insert": {
      create(context) {
        const frames = [];
        const enter = () => frames.push({ reads: [], inserts: [], awaits: [] });
        const exit = () => {
          const { reads, inserts, awaits } = frames.pop();
          for (const insert of inserts) {
            const raced = reads.some(
              (read) =>
                read.table === insert.table &&
                awaits.some((resumed) => resumed >= read.end && resumed <= insert.start),
            );
            if (raced) context.report({ node: insert.node, message: RACE_MESSAGE });
          }
        };
        return {
          Program: enter,
          "Program:exit": exit,
          FunctionDeclaration: enter,
          "FunctionDeclaration:exit": exit,
          FunctionExpression: enter,
          "FunctionExpression:exit": exit,
          ArrowFunctionExpression: enter,
          "ArrowFunctionExpression:exit": exit,
          AwaitExpression(node) {
            frames.at(-1).awaits.push(node.end ?? node.range[1]);
          },
          CallExpression(node) {
            const frame = frames.at(-1);
            const start = node.start ?? node.range[0];
            const end = node.end ?? node.range[1];
            const read = readTable(node);
            if (read) frame.reads.push({ table: read, end });
            const insert = insertTable(node);
            if (insert) frame.inserts.push({ table: insert, start, node });
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
        const held = [];
        const loaders = [];
        const localNames = new Set();
        const effectNames = new Set();
        const insideEffect = (node) => {
          for (let p = node.parent; p; p = p.parent) if (isEffectCall(p)) return true;
          return false;
        };
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
            if (!isLoadCall(node)) {
              const name = loaderName(node);
              if (name && insideEffect(node))
                loaders.push({ node, name, member: node.callee.type === "MemberExpression" });
              return;
            }
            for (let p = node.parent; p; p = p.parent) {
              if (isEffectCall(p)) {
                context.report({ node, message: LOAD_IN_EFFECT_MESSAGE });
                return;
              }
            }
            held.push({ node, names: holderNames(node) });
          },
          FunctionDeclaration(node) {
            if (node.id) localNames.add(node.id.name);
          },
          VariableDeclarator(node) {
            if (node.id.type === "Identifier") localNames.add(node.id.name);
          },
          "Program:exit"() {
            for (const { node, names } of held) {
              if (names.some((n) => effectNames.has(n))) {
                context.report({ node, message: LOAD_IN_EFFECT_MESSAGE });
              }
            }
            for (const { node, name, member } of loaders) {
              if (member || !localNames.has(name)) {
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
