/**
 * Change-detection tripwire for the erasure inventory (TASK-006, AE-SI-7). DEMOTED by the narrowed TASK-006 invariant
 * (SPEC "Decision log: TASK-006 narrowed invariant"): it is NOT proof that the inventory covers all persistence in the
 * repository. It catches a new or renamed uid-bearing name or collection literal in the common syntactic forms, so that a
 * change without an inventory update is noticed. Completeness of the current inventory is established by the
 * both-direction reconciliation recorded in VERIFICATION.md, and every future change is reviewed under the change-control
 * rule. Pure: it inspects the source text it is given and never reads the file system. The test in inventory.test.ts
 * supplies the repository source.
 *
 * Syntax is read structurally with the TypeScript compiler API (already a devDependency), not with text patterns. Quote
 * style, whitespace, comments, trailing commas, semicolons, member modifiers (`readonly`), optional members, and the
 * one-line versus multi-line layout do not change what is found, because the parser has already removed them.
 *
 * The tripwire reports a file that contains
 *  - a uid-bearing name in a persisted or read position (object key, shorthand property, property signature or
 *    declaration, member read, or any string literal) that is neither registered nor allow-listed;
 *  - a collection path segment (`collection`, `collectionGroup`, a `doc` path, or a `*_COLLECTION` constant) that is
 *    neither registered nor allow-listed;
 *  - a collection path that cannot be resolved statically, other than a reference to a `*_COLLECTION` constant (fail closed);
 *  - an allow-list entry that no longer occurs in the scanned source (stale exception).
 *
 * Recorded limitations (also in VERIFICATION.md). Not a whole-program proof: TypeScript has many equivalent ways to reach
 * a Firestore operation (aliases, destructuring, `.call`/`.apply`, rebinding, constants passed as values), and the
 * tripwire covers only the listed syntactic shapes.
 *  - Name-based: a registered name is treated as covered wherever it appears. The guard does not prove that a name is
 *    persisted; review still decides that.
 *  - `doc()` with a non-literal path is not resolved, because modular `doc(ref, id)` takes dynamic identifiers.
 *  - A dynamic element access `x[expr]` or computed key `{ [expr]: v }` fails closed inside a Firestore write or query call
 *    argument (`PERSISTENCE_CALLS`). Elsewhere it is not resolved (an array index, a label map). A dynamic key built into a
 *    variable first is not resolved. Persisted
 *    writes must use explicit keys; review checks each new write.
 *  - Only the scanned roots are checked (see inventory.test.ts).
 */
import ts from "typescript";

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface GuardViolation {
  readonly kind:
    | "unregistered-field"
    | "unregistered-collection"
    | "unresolvable-collection"
    | "unresolvable-field"
    | "unresolvable-call"
    | "stale-allow-list";
  readonly name: string;
  readonly path?: string;
}

export interface GuardInput {
  readonly files: readonly SourceFile[];
  readonly registeredFields: ReadonlyMap<string, string>;
  readonly registeredCollectionSegments: ReadonlySet<string>;
  readonly allowedFields: Readonly<Record<string, string>>;
  /** Names allowed only as a member read (`x.name`), never as a key or literal. Optional; defaults to none. */
  readonly allowedMemberAccess?: Readonly<Record<string, string>>;
  readonly allowedCollections: Readonly<Record<string, string>>;
  /** Exact, structural exceptions for a dynamic key inside a write (see ApprovedDynamicKey). Optional; defaults to none. */
  readonly approvedDynamicKeys?: readonly ApprovedDynamicKey[];
  /** Exact, structural exceptions for a dynamic FieldPath delete in a transaction update (see ApprovedDynamicFieldPath). */
  readonly approvedDynamicFieldPaths?: readonly ApprovedDynamicFieldPath[];
}

/**
 * One approved dynamic-key write shape. It matches only when ALL of these hold: the file is `path`; the computed key is
 * the identifier `keyIdentifier`; that key is the only entry of an object literal that is the value of a `parentProperty`
 * property; and that object literal is an argument of a call to `writeCall`, with the outer object literal as that
 * argument. No line number and no broader pattern is involved.
 */
export interface ApprovedDynamicKey {
  readonly path: string;
  readonly writeCall: string;
  readonly parentProperty: string;
  readonly keyIdentifier: string;
  /** The identifier the write is called on (`tx.set`), so another receiver's `set` does not match. */
  readonly receiver: string;
  /** The only enclosing method in which the shape is accepted; `keyIdentifier` must be its parameter and not rebound. */
  readonly enclosingMethod: string;
  /** The exact structural place the method must sit in (see ApprovedContext). A same-named method elsewhere does not match. */
  readonly context: ApprovedContext;
  readonly reason: string;
}

/**
 * The exact structure an approved method must belong to: the method is a member of the object literal passed to
 * `workCall(...)`, inside the method `transactionMethod`, whose object literal is returned by the top-level function
 * `factoryFunction`. The names are checked, not line numbers, and no other structure matches.
 */
export interface ApprovedContext {
  readonly factoryFunction: string;
  readonly transactionMethod: string;
  readonly workCall: string;
}

/**
 * One approved dynamic FieldPath delete (TASK-006, C1 `removeLevel`). It matches only when ALL of these hold: the file is
 * `path`; the call is `receiver.update(ref, new FieldPath(firstSegment, keyIdentifier), FieldValue.delete(), …)`, the
 * variadic transaction update; the FieldPath has exactly those two arguments, a static first segment and the identifier
 * `keyIdentifier`; and the call sits directly inside the method `enclosingMethod`, whose parameter list declares
 * `keyIdentifier`. No line number and no broader pattern is involved.
 */
export interface ApprovedDynamicFieldPath {
  readonly path: string;
  /** The identifier the update is called on (`tx.update`), so another receiver's `update` does not match. */
  readonly receiver: string;
  readonly firstSegment: string;
  readonly keyIdentifier: string;
  /** The only enclosing method in which the shape is accepted. */
  readonly enclosingMethod: string;
  /** The exact structural place the method must sit in (see ApprovedContext). */
  readonly context: ApprovedContext;
  readonly reason: string;
}

export interface GuardReport {
  readonly violations: readonly GuardViolation[];
  /** Distinct collection path segments found in the scanned source (for sanity checks). */
  readonly collectionSegmentsSeen: ReadonlySet<string>;
  /** Distinct uid-bearing field names found in the scanned source. */
  readonly uidBearingFieldsSeen: ReadonlySet<string>;
}

/** Names that may carry a person identifier. Suffix rules are deliberately broad; the allow-list handles false positives. */
export const UID_BEARING_NAME =
  /^(uid|email|normalizedEmail|memberRef|ownerRef|ownerUid|authorUid|participantUid|participantMemberRef|resolvedUid|memberUid|presenterUid|candidateUid|actorUid|userId|ownerId|authorId|personId|employeeId)$|(Uid|By|Ref|Email)$/;

const IDENTIFIER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Stands in for an interpolated template span, so a dynamic segment is recognisable. */
const DYNAMIC = "\u0000";
const COLLECTION_CALLS = new Set(["collection", "collectionGroup"]);

/** What one source file contributes, read from its syntax tree. */
interface FileFacts {
  /** Names in key, shorthand, signature, declaration, or string-literal position. */
  readonly keys: string[];
  /** Names read as a member (`x.name`), excluding method calls. */
  readonly members: string[];
  /** Static collection path segments (even-indexed path segments only; odd ones are document IDs). */
  readonly collections: string[];
  /** Syntax that cannot be resolved statically, with its source text, for a fail-closed violation. */
  readonly unresolved: { kind: "unresolvable-collection" | "unresolvable-field" | "unresolvable-call"; text: string }[];
}

export function checkInventoryCoverage(input: GuardInput): GuardReport {
  const violations: GuardViolation[] = [];
  const collectionSegmentsSeen = new Set<string>();
  const uidBearingFieldsSeen = new Set<string>();
  const seenFieldNames = new Set<string>();
  const seenMemberNames = new Set<string>();
  const allowedMemberAccess = input.allowedMemberAccess ?? {};
  const shared = sharedFieldConstants(input.files);

  for (const file of input.files) {
    const facts = scanSource(file.path, file.text, input.approvedDynamicKeys ?? [], input.approvedDynamicFieldPaths ?? [], shared);

    for (const name of facts.keys) {
      seenFieldNames.add(name);
      if (!UID_BEARING_NAME.test(name)) continue;
      uidBearingFieldsSeen.add(name);
      if (!input.registeredFields.has(name) && !(name in input.allowedFields)) {
        violations.push({ kind: "unregistered-field", name, path: file.path });
      }
    }

    for (const name of facts.members) {
      seenMemberNames.add(name);
      if (!UID_BEARING_NAME.test(name)) continue;
      uidBearingFieldsSeen.add(name);
      if (!input.registeredFields.has(name) && !(name in input.allowedFields) && !(name in allowedMemberAccess)) {
        violations.push({ kind: "unregistered-field", name, path: file.path });
      }
    }

    for (const segment of facts.collections) {
      collectionSegmentsSeen.add(segment);
      if (!input.registeredCollectionSegments.has(segment) && !(segment in input.allowedCollections)) {
        violations.push({ kind: "unregistered-collection", name: segment, path: file.path });
      }
    }

    for (const { kind, text } of facts.unresolved) {
      violations.push({ kind, name: text, path: file.path });
    }
  }

  for (const name of Object.keys(input.allowedFields)) {
    if (!seenFieldNames.has(name)) violations.push({ kind: "stale-allow-list", name });
  }
  for (const name of Object.keys(allowedMemberAccess)) {
    if (!seenMemberNames.has(name)) violations.push({ kind: "stale-allow-list", name });
  }
  for (const name of Object.keys(input.allowedCollections)) {
    if (!collectionSegmentsSeen.has(name)) violations.push({ kind: "stale-allow-list", name });
  }

  return { violations, collectionSegmentsSeen, uidBearingFieldsSeen };
}

function scanSource(
  path: string,
  text: string,
  approvedDynamicKeys: readonly ApprovedDynamicKey[],
  approvedDynamicFieldPaths: readonly ApprovedDynamicFieldPath[],
  sharedConstants: ReadonlyMap<string, string>,
): FileFacts {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const keys: string[] = [];
  const members: string[] = [];
  const collections: string[] = [];
  const unresolved: FileFacts["unresolved"] = [];
  // Same-file constants win over shared ones; a name cannot be both (a local declaration would count as a second one).
  const localStrings = new Map<string, string>([...sharedConstants, ...staticStringConstants(source)]);

  const visit = (node: ts.Node): void => {
    // Every string literal (quoted, single, or static backtick) is a potential field or collection name. A string used as
    // a property name is also a string literal, so it is counted here exactly once.
    // A dotted or slash path (`"levels.ownerUid"`) names each of its segments.
    if (ts.isStringLiteralLike(node)) keys.push(...node.text.split(/[./]/));

    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
      const name = node.name;
      if (name !== undefined && ts.isIdentifier(name)) keys.push(name.text);
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && isCollectionConstantName(node.name.text)) {
        collectionPathSegments(node.initializer, collections, unresolved, localStrings);
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && FIELD_CONSTANT_NAME.test(node.name.text) && node.initializer !== undefined && ts.isStringLiteralLike(node.initializer)) {
      keys.push(node.initializer.text);
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isCollectionConstantName(node.name.text) && node.initializer !== undefined) {
      collectionPathSegments(node.initializer, collections, unresolved, localStrings);
    }

    // A method call such as `auth.lookupUid(id)` is not a stored field. Any other member read is.
    if (ts.isPropertyAccessExpression(node) && !isCalleeOf(node)) {
      members.push(node.name.text);
    }

    // A destructured read (`const { ownerUid } = data`) names a stored field just as a member read does.
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key)) keys.push(key.text);
    }

    // A computed key (`{ [name]: v }`) or element access (`x[name]`) with a non-static name can name any field. Inside the
    // arguments of a Firestore write or query it names a persisted field, so that case fails closed. Elsewhere (for
    // example an index into an array or a label map) it is a recorded limitation; see the header.
    if (
      ts.isComputedPropertyName(node) &&
      !isStaticName(node.expression, localStrings) &&
      isInPersistenceCall(node) &&
      !isApprovedDynamicKey(node, path, approvedDynamicKeys)
    ) {
      unresolved.push({ kind: "unresolvable-field", text: node.getText() });
    }
    if (ts.isElementAccessExpression(node) && !isStaticName(node.argumentExpression, localStrings) && isInPersistenceCall(node)) {
      unresolved.push({ kind: "unresolvable-field", text: node.getText() });
    }

    if (ts.isCallExpression(node)) {
      const callee = callHeadName(node.expression);
      // Closed world for the persistence boundary: a callee that cannot be named statically (`getRef()(…)`, `handlers[k](…)`)
      // is not classified, so a call that carries a key, path, or identity name fails closed instead of being ignored.
      if (callee === undefined && mayCarryPersistenceName(node, localStrings)) {
        unresolved.push({ kind: "unresolvable-call", text: node.getText() });
      }
      // A query's first argument is the field path (`where(field, "==", v)`); a dynamic one names an unknown field.
      if (callee !== undefined && QUERY_FIELD_CALLS.has(callee) && node.arguments.length > 0 && !isStaticName(node.arguments[0], localStrings)) {
        unresolved.push({ kind: "unresolvable-field", text: node.arguments[0].getText() });
      }
      // The variadic update form (`update(ref, field, value, …)`): a dynamic field name at position 1 is unknown.
      if (callee !== undefined && UPDATE_CALLS.has(callee)) {
        for (const field of dynamicUpdateFields(node, path, approvedDynamicFieldPaths, localStrings)) {
          unresolved.push({ kind: "unresolvable-field", text: field.getText() });
        }
      }
      const head = callHeadName(node.expression);
      if (head !== undefined && (COLLECTION_CALLS.has(head) || head === "doc")) {
        pathOfCall(node, head, collections, unresolved, localStrings);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return {
    keys: keys.filter((name) => IDENTIFIER_NAME.test(name)),
    members,
    collections,
    unresolved,
  };
}

/**
 * The collection path of a `collection`, `collectionGroup` or `doc` call. The modular form (`collection(db, path)`) takes
 * the path at index 1; the method form (`db.collection(path)`) takes it at index 0.
 */
function pathOfCall(
  call: ts.CallExpression,
  head: string,
  collections: string[],
  unresolved: FileFacts["unresolved"],
  localStrings: ReadonlyMap<string, string>,
): void {
  const modular = ts.isIdentifier(unwrapCallee(call.expression));
  const pathArgument = call.arguments[modular ? 1 : 0];
  if (pathArgument === undefined) {
    if (head !== "doc") unresolved.push({ kind: "unresolvable-collection", text: call.getText() });
    return;
  }
  if (head === "doc") {
    // Modular `doc(db, path, ...ids)`: the path may be one collection name followed by IDs (`doc(db, "coll", id)`), so
    // a single static segment is checked there. A method `.doc(id)` takes a document ID, so only a multi-segment path is a
    // collection path. A modular call whose first argument is a collection or document reference takes an ID, not a path.
    const segments = staticSegments(pathArgument, localStrings);
    if (segments === undefined) return;
    const fromDatabase = modular && !isReferenceCall(call.arguments[0]);
    if (fromDatabase || segments.length > 1) collectionSegments(segments, collections, unresolved, pathArgument);
    return;
  }
  collectionPathSegments(pathArgument, collections, unresolved, localStrings);
}

/** A collection path (`collection`, `collectionGroup`, or a `*_COLLECTION` constant): its even-indexed segments are names. */
function collectionPathSegments(
  expression: ts.Expression,
  collections: string[],
  unresolved: FileFacts["unresolved"],
  localStrings: ReadonlyMap<string, string>,
): void {
  // A reference to a named `*_COLLECTION` constant is checked where the constant is defined (its initializer is a
  // static path, or it is itself unresolved there). The reference site therefore adds nothing here.
  if (referencesCollectionConstant(expression)) return;
  const segments = staticSegments(expression, localStrings);
  if (segments === undefined) {
    unresolved.push({ kind: "unresolvable-collection", text: expression.getText() });
    return;
  }
  collectionSegments(segments, collections, unresolved, expression);
}

function collectionSegments(segments: string[], collections: string[], unresolved: FileFacts["unresolved"], origin: ts.Node): void {
  segments.forEach((segment, index) => {
    if (index % 2 !== 0) return;
    if (segment.includes(DYNAMIC)) {
      unresolved.push({ kind: "unresolvable-collection", text: origin.getText() });
      return;
    }
    collections.push(segment);
  });
}

/**
 * The `/`-separated segments of a static path, or `undefined` when the expression is not a static string. An
 * interpolated span becomes a `DYNAMIC` marker inside its segment.
 */
function staticSegments(expression: ts.Expression, localStrings: ReadonlyMap<string, string>): string[] | undefined {
  if (ts.isStringLiteralLike(expression)) return expression.text.split("/");
  // A same-file `const NAME = "static/path"` is resolved here, so `collection(db, NAME)` is checked, not skipped.
  if (ts.isIdentifier(expression)) {
    const value = localStrings.get(expression.text);
    return value?.split("/");
  }
  if (ts.isTemplateExpression(expression)) {
    const joined = expression.head.text + expression.templateSpans.map((span) => DYNAMIC + span.literal.text).join("");
    return joined.split("/");
  }
  return undefined;
}

/**
 * A named collection or subcollection constant (`FOO_COLLECTION`, `FOO_SUBCOLLECTION`). Its definition is checked where
 * it is declared, so a reference to it is accepted here rather than re-derived.
 */
function isCollectionConstantName(name: string): boolean {
  return /_(SUB)?COLLECTION$/.test(name);
}

/**
 * True when a computed key matches an approved shape exactly: `{ <parentProperty>: { [keyIdentifier]: … } }` as an argument
 * of `writeCall`, in the approved file. Every other structure, file, or key name returns false.
 */
function isApprovedDynamicKey(name: ts.ComputedPropertyName, path: string, approved: readonly ApprovedDynamicKey[]): boolean {
  if (!ts.isIdentifier(name.expression)) return false;
  const member = name.parent;
  if (!ts.isPropertyAssignment(member) || member.name !== name) return false;
  const inner = member.parent;
  if (!ts.isObjectLiteralExpression(inner) || inner.properties.length !== 1) return false;
  const outerProperty = inner.parent;
  if (!ts.isPropertyAssignment(outerProperty) || !ts.isIdentifier(outerProperty.name)) return false;
  const outer = outerProperty.parent;
  if (!ts.isObjectLiteralExpression(outer)) return false;
  const call = outer.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(outer)) return false;
  const head = callHeadName(call.expression);
  const receiver = calleeReceiver(call.expression);
  const propertyName = outerProperty.name.text;
  const keyName = name.expression.text;
  const method = enclosingMethodOf(call);
  if (method === undefined) return false;
  return approved.some(
    (shape) =>
      shape.path === path &&
      shape.writeCall === head &&
      shape.receiver === receiver &&
      shape.parentProperty === propertyName &&
      shape.keyIdentifier === keyName &&
      shape.enclosingMethod === method.name &&
      method.parameters.includes(keyName) &&
      !rebindsName(method.declaration, keyName) &&
      inApprovedContext(method.declaration, shape.context),
  );
}

/**
 * True when a transaction update matches an approved FieldPath delete exactly: `receiver.update(ref,
 * new FieldPath(firstSegment, keyIdentifier), FieldValue.delete(), …)` directly inside the approved method. Every other
 * FieldPath (other segments, other identifiers, a dynamic first segment, extra segments), any other value, any other
 * receiver, any other enclosing method, and any other file returns false.
 */
function isApprovedFieldPathDelete(call: ts.CallExpression, path: string, approved: readonly ApprovedDynamicFieldPath[]): boolean {
  const fieldPath = call.arguments[1];
  const value = call.arguments[2];
  if (!ts.isNewExpression(fieldPath) || !ts.isIdentifier(fieldPath.expression) || fieldPath.expression.text !== "FieldPath") return false;
  const segments = fieldPath.arguments ?? [];
  if (segments.length !== 2) return false;
  const [first, second] = segments;
  if (!ts.isStringLiteralLike(first) || !ts.isIdentifier(second)) return false;
  if (!isFieldValueDelete(value)) return false;
  if (callHeadName(call.expression) !== "update") return false;
  const receiver = calleeReceiver(call.expression);
  const method = enclosingMethodOf(call);
  if (method === undefined) return false;
  return approved.some(
    (shape) =>
      shape.path === path &&
      shape.receiver === receiver &&
      shape.firstSegment === first.text &&
      shape.keyIdentifier === second.text &&
      shape.enclosingMethod === method.name &&
      method.parameters.includes(shape.keyIdentifier) &&
      !rebindsName(method.declaration, shape.keyIdentifier) &&
      inApprovedContext(method.declaration, shape.context),
  );
}

/**
 * True when `method` is a member of the object literal passed to `context.workCall(...)`, inside the method
 * `context.transactionMethod`, whose object literal is the returned value of the top-level function
 * `context.factoryFunction`. Any other structure, including a same-named method in a class or another object, returns false.
 */
function inApprovedContext(method: ts.MethodDeclaration, context: ApprovedContext): boolean {
  const members = method.parent;
  if (!ts.isObjectLiteralExpression(members)) return false;
  const workCall = members.parent;
  if (!ts.isCallExpression(workCall) || !ts.isIdentifier(workCall.expression) || workCall.expression.text !== context.workCall) {
    return false;
  }
  const transaction = enclosingMethodDeclaration(workCall);
  if (transaction === undefined || !ts.isIdentifier(transaction.name) || transaction.name.text !== context.transactionMethod) {
    return false;
  }
  const returned = transaction.parent;
  if (!ts.isObjectLiteralExpression(returned)) return false;
  const statement = returned.parent;
  if (!ts.isReturnStatement(statement) || !ts.isBlock(statement.parent)) return false;
  const factory = statement.parent.parent;
  return (
    ts.isFunctionDeclaration(factory) &&
    factory.name?.text === context.factoryFunction &&
    ts.isSourceFile(factory.parent)
  );
}

/** The innermost enclosing method declaration of a node, skipping arrow functions and closures between them. */
function enclosingMethodDeclaration(node: ts.Node): ts.MethodDeclaration | undefined {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isMethodDeclaration(parent)) return parent;
  }
  return undefined;
}

/**
 * True when the method body declares or assigns `name` anywhere (an inner `const`, a block binding, a nested parameter, or a
 * reassignment). The approved FieldPath segment must be the method's own parameter, so such a name disqualifies the shape.
 */
function rebindsName(method: ts.MethodDeclaration, name: string): boolean {
  if (method.body === undefined) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (declaredNamesOf(node).includes(name) || assignedName(node) === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(method.body);
  return found;
}

/** `FieldValue.delete()`, the only value an approved FieldPath delete may carry. */
function isFieldValueDelete(value: ts.Expression): boolean {
  return (
    ts.isCallExpression(value) &&
    value.arguments.length === 0 &&
    ts.isPropertyAccessExpression(value.expression) &&
    ts.isIdentifier(value.expression.expression) &&
    value.expression.expression.text === "FieldValue" &&
    value.expression.name.text === "delete"
  );
}

/** The innermost enclosing function. Returned only when it is a named method, so a closure inside a method is not approved. */
function enclosingMethodOf(
  node: ts.Node,
): { name: string; parameters: string[]; declaration: ts.MethodDeclaration } | undefined {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    if (!ts.isMethodDeclaration(parent) || !ts.isIdentifier(parent.name)) return undefined;
    const parameters = parent.parameters.flatMap((parameter) => (ts.isIdentifier(parameter.name) ? [parameter.name.text] : []));
    return { name: parent.name.text, parameters, declaration: parent };
  }
  return undefined;
}

/** Firestore write and query methods whose arguments name persisted fields. */
const PERSISTENCE_CALLS = new Set([
  "set", "update", "create", "add", "delete", "where", "orderBy", "startAt", "endAt", "startAfter", "endBefore",
  "setDoc", "updateDoc", "addDoc", "deleteDoc",
]);
/** Query calls whose first argument is a field path. */
const QUERY_FIELD_CALLS = new Set(["where", "orderBy", "startAt", "endAt", "startAfter", "endBefore"]);
/** Update calls: the object form has two arguments; the variadic field/value form has three or more. */
const UPDATE_CALLS = new Set(["update", "updateDoc"]);

/** True when `node` is inside an argument of a Firestore write or query call (`tx.set(ref, …)`, `q.where(…)`). */
function isInPersistenceCall(node: ts.Node): boolean {
  let child: ts.Node = node;
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isCallExpression(parent) && parent.arguments.includes(child as ts.Expression)) {
      const head = callHeadName(parent.expression);
      if (head !== undefined && PERSISTENCE_CALLS.has(head)) return true;
    }
    child = parent;
  }
  return false;
}

/** A name the guard can read without running code: a string or number literal, or a same-file static constant. */
function isStaticName(expression: ts.Expression, localStrings: ReadonlyMap<string, string>): boolean {
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) return true;
  // `FieldPath.documentId()` is Firestore's fixed document-ID ordering field, not a stored or dynamic field name.
  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length === 0 &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "FieldPath" &&
    expression.expression.name.text === "documentId"
  ) {
    return true;
  }
  if (!ts.isIdentifier(expression)) return false;
  // Only a `const` string constant declared once in the scan (same file, or a shared `*_FIELD` import of one) is static.
  // A `*_FIELD` name is not trusted by its suffix: its initializer may be dynamic, or it may be declared twice.
  return localStrings.has(expression.text);
}

/**
 * The field positions of a variadic transaction update (`update(ref, field, value, field, value, …)`) that are not static
 * names. Position 1 may be the approved FieldPath delete. Every later field position (3, 5, …) is checked the same way, and
 * a spread in a field position must list only static names at its even positions. Returns the offending argument nodes.
 */
function dynamicUpdateFields(
  call: ts.CallExpression,
  path: string,
  approved: readonly ApprovedDynamicFieldPath[],
  localStrings: ReadonlyMap<string, string>,
): ts.Expression[] {
  const args = call.arguments;
  const dynamic: ts.Expression[] = [];
  // Without a spread, a two-argument call is the object form `update(ref, data)` and has no field positions.
  if (args.length < 3 && !args.some(ts.isSpreadElement)) return dynamic;
  // A spread can carry any number of pairs, so it is accepted only as the final argument, in a field position (odd, >= 3),
  // with a static array-literal form. Any other spread fails closed, and it also shifts every position after it.
  args.forEach((arg, index) => {
    if (!ts.isSpreadElement(arg)) return;
    const finalFieldSpread = index >= 3 && index % 2 === 1 && index === args.length - 1;
    if (!finalFieldSpread || !spreadNamesAreStatic(arg.expression, localStrings)) dynamic.push(arg);
  });
  for (let index = 1; index < args.length; index += 2) {
    const field = args[index];
    if (ts.isSpreadElement(field)) continue;
    if (index === 1 && isApprovedFieldPathDelete(call, path, approved)) continue;
    if (!isStaticName(field, localStrings)) dynamic.push(field);
  }
  return dynamic;
}

/** A spread of field/value pairs (`...(c ? ["createdAt", v] : [])`): each even element is a static name, no odd element spreads. */
function spreadNamesAreStatic(expression: ts.Expression, localStrings: ReadonlyMap<string, string>): boolean {
  if (ts.isParenthesizedExpression(expression)) return spreadNamesAreStatic(expression.expression, localStrings);
  if (ts.isConditionalExpression(expression)) {
    return spreadNamesAreStatic(expression.whenTrue, localStrings) && spreadNamesAreStatic(expression.whenFalse, localStrings);
  }
  if (!ts.isArrayLiteralExpression(expression)) return false;
  return expression.elements.every((element, index) => {
    if (ts.isSpreadElement(element)) return false;
    return index % 2 === 1 || isStaticName(element, localStrings);
  });
}

/** A named field-name constant (`SKILL_CONTRIBUTION_FIELD`). Its definition is checked as a key where it is declared. */
const FIELD_CONSTANT_NAME = /_FIELD$/;

/** True when `expression` is a collection or document reference call, so a following literal is a document ID. */
function isReferenceCall(expression: ts.Expression | undefined): boolean {
  if (expression === undefined || !ts.isCallExpression(expression)) return false;
  const head = callHeadName(expression.expression);
  return head === "collection" || head === "collectionGroup" || head === "doc";
}

function referencesCollectionConstant(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return isCollectionConstantName(expression.text);
  if (ts.isPropertyAccessExpression(expression)) return isCollectionConstantName(expression.name.text);
  return false;
}

/**
 * Same-file `const NAME = "static"` declarations. A name declared twice with different values is ambiguous and is dropped,
 * so a path through it is unresolved (fail closed), not guessed.
 */
function staticStringConstants(source: ts.SourceFile): ReadonlyMap<string, string> {
  return resolvedConstants(constantFacts(source, true));
}

/**
 * `*_FIELD` constants declared anywhere in the scanned source. An imported field constant (`import { SKILL_CONTRIBUTION_FIELD }`)
 * is resolved here, because an import is not a declaration. A name qualifies only when its single declaration in the whole
 * scan is a `const` string literal and nothing assigns it. An imported `*_FIELD` whose definition lies outside the scan is
 * not resolved (a recorded limitation in VERIFICATION.md).
 */
function sharedFieldConstants(files: readonly SourceFile[]): ReadonlyMap<string, string> {
  const counts = new Map<string, number>();
  const mutated = new Set<string>();
  const constants = new Map<string, string>();
  for (const file of files) {
    const facts = constantFacts(ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKindFor(file.path)), false);
    for (const [name, count] of facts.declarationCounts) counts.set(name, (counts.get(name) ?? 0) + count);
    for (const name of facts.mutated) mutated.add(name);
    for (const [name, value] of facts.constants) constants.set(name, value);
  }
  const resolved = new Map<string, string>();
  for (const [name, value] of constants) {
    if (FIELD_CONSTANT_NAME.test(name) && counts.get(name) === 1 && !mutated.has(name)) resolved.set(name, value);
  }
  return resolved;
}

interface ConstantFacts {
  readonly declarationCounts: ReadonlyMap<string, number>;
  readonly mutated: ReadonlySet<string>;
  readonly constants: ReadonlyMap<string, string>;
}

/** The declarations, assignments and `const` string literals of one file. Imports count as declarations only when asked. */
function constantFacts(source: ts.SourceFile, countImports: boolean): ConstantFacts {
  const declarationCounts = new Map<string, number>();
  const mutated = new Set<string>();
  const constants = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    const imported = ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node);
    if (countImports || !imported) {
      for (const name of declaredNamesOf(node)) declarationCounts.set(name, (declarationCounts.get(name) ?? 0) + 1);
    }
    const assigned = assignedName(node);
    if (assigned !== undefined) mutated.add(assigned);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.initializer !== undefined &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { declarationCounts, mutated, constants };
}

/**
 * A constant is static only when its name is declared once and never assigned. A parameter, an inner binding, or a
 * reassignment that shares the name makes the name dynamic, so a path through it fails closed.
 */
function resolvedConstants(facts: ConstantFacts): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>();
  for (const [name, value] of facts.constants) {
    if (facts.declarationCounts.get(name) === 1 && !facts.mutated.has(name)) resolved.set(name, value);
  }
  return resolved;
}

/** Identifier names a node introduces into scope: variable, parameter, binding, function, class, and import names. */
function declaredNamesOf(node: ts.Node): string[] {
  if (
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node)
  ) {
    return node.name !== undefined && ts.isIdentifier(node.name) ? [node.name.text] : [];
  }
  return [];
}

/**
 * True when an unclassified call could be a persistence or query operation that hides its field or collection name. Such a
 * call has a dynamic key, a dynamic element access, or a FieldPath in its arguments, or it is a dynamic element access
 * (`db[name]("path")`) that receives a static string path. An unclassified call with none of these is outside the boundary
 * (for example `import("…")`, `super("…")`, or a function value called with a list) and is not reported.
 */
function mayCarryPersistenceName(call: ts.CallExpression, localStrings: ReadonlyMap<string, string>): boolean {
  const callee = unwrapCallee(call.expression);
  const [first] = call.arguments;
  if (
    ts.isElementAccessExpression(callee) &&
    !isStaticName(callee.argumentExpression, localStrings) &&
    first !== undefined &&
    ts.isStringLiteralLike(first)
  ) {
    return true;
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const risky =
      ts.isComputedPropertyName(node) ||
      (ts.isElementAccessExpression(node) && !isStaticName(node.argumentExpression, localStrings)) ||
      (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "FieldPath");
    if (risky) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  call.arguments.forEach(visit);
  return found;
}

/** The identifier an assignment or increment writes to, or `undefined`. */
function assignedName(node: ts.Node): string | undefined {
  if (
    ts.isBinaryExpression(node) &&
    ts.isIdentifier(node.left) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return node.left.text;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    ts.isIdentifier(node.operand) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return node.operand.text;
  }
  return undefined;
}

/** `collection`, `doc`, … for `collection(…)`, `db.collection(…)`; `undefined` for any other callee. */
function callHeadName(callee: ts.Expression): string | undefined {
  const target = unwrapCallee(callee);
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  // A static string element access names the same method: `tx["set"]` is `tx.set`.
  if (ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)) {
    return target.argumentExpression.text;
  }
  return undefined;
}

/** A callee with its syntactic wrappers removed: parentheses and non-null assertions do not change what is called. */
function unwrapCallee(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
  return current;
}

/** The identifier a statically named method is called on (`tx` in `(tx)["set"]`), or `undefined` for any other receiver. */
function calleeReceiver(callee: ts.Expression): string | undefined {
  if (callHeadName(callee) === undefined) return undefined;
  const target = unwrapCallee(callee);
  if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return undefined;
  const object = unwrapCallee(target.expression);
  return ts.isIdentifier(object) ? object.text : undefined;
}

function isCalleeOf(access: ts.PropertyAccessExpression): boolean {
  const parent = access.parent;
  return ts.isCallExpression(parent) && parent.expression === access;
}

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
