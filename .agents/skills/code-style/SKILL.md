---
name: code-style
description: 코드 작성, 함수 작성, 리팩토링, 새 파일 생성, TypeScript/JavaScript 코드 수정 시 반드시 적용해야 하는 코드 스타일 가이드라인. 모든 코드 작업에 이 스킬을 사용하세요.
---

# Code Style

## 1. Basic coding style

- All code is written with readability, maintainability, security, and scalability as priorities.
- This SDK is built by Node.js at build time, but its distributed runtime code runs in browsers. Runtime source files such as `packages/core/src` and `packages/uikit/src` must not depend on Node.js or bundler environment values like `process.env`, `NODE_ENV`, `import.meta.env`, `globalThis.process`, or `__DEV__`. If environment-specific behavior is needed, use explicit public API options, dependency injection, or build configuration instead. Node.js environment values are only allowed in build config, tests, and scripts.
- We don't use enum, or namespace. We don't write code that violates "erasableSyntaxOnly", which was added in TypeScript 5.8.
- Don't use non-null assertions.
- Don't use type assertions.
- Separate the interface and implementation of a module.
- Different modules rely on interfaces.
- Don't use meaningless variable names. Use variable names that are long enough to convey meaning.
- Follow the biome lint rules and don't write code that causes lint errors.

- Even if there is nothing to return, the curly braces must be present.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// listPageCachePolicy.ts
export const listPageCachePolicy = (a: string) => {
  if (typeof a !== "string") return
};

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// listPageCachePolicy.ts
export const listPageCachePolicy = (a: string) => {
  if (typeof a !== "string") {
    return;
  }
};
```

```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// listPageCachePolicy.ts
export const listPageCachePolicy = (a: string) => {
  if (typeof a !== "string") return null;
};

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// listPageCachePolicy.ts
export const listPageCachePolicy = (a: string) => {
  if (typeof a !== "string") {
    return null;
  }
};
```

- Put functions that export at the top and functions that don't export at the bottom. We use function declarations to do this.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// listPageCachePolicy.ts
const detailPageCachePolicy = () => ({
  "Cache-Control": ["public", "s-maxage=0", "max-age=0"].join(", "),
});

export const listPageCachePolicy = () => ({
  "Cache-Control": ["no-store", "no-cache", "must-revalidate"].join(", "),
});

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// listPageCachePolicy.ts
export function listPageCachePolicy() {
  return {
    "Cache-Control": ["public", "s-maxage=0", "max-age=0"].join(", ")
  };
};

function detailPageCachePolicy() {
  return {
    "Cache-Control": ["public", "s-maxage=0", "max-age=0"].join(", ")
  };
};
```

- Preferably, only one named export from one file. However, multiple exports are allowed when they have similar roles or are needed together to perform a specific function.

```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// utils.ts - Completely unrelated functions
export function getCurrentDate() {
  return new Date();
}

export function generateRandomId() {
  return Math.random().toString(36);
}

export function calculateDiscount(price: number) {
  return price * 0.9;
}
```

**Why is this wrong?**
- `getCurrentDate`, `generateRandomId`, `calculateDiscount` are completely independent
- Using one doesn't require the others
- No common role or domain

```typescript
// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// Independent functions should be in separate files
// getCurrentDate.ts
export function getCurrentDate() {
  return new Date();
}

// generateRandomId.ts
export function generateRandomId() {
  return Math.random().toString(36);
}

// calculateDiscount.ts
export function calculateDiscount(price: number) {
  return price * 0.9;
}
```

- When functions have similar roles or are needed together, you can use one of these methods:

**Method A: Bundle as object**
```typescript
// ✅ ACCEPTABLE: Related functions bundled as object
// dateUtils.ts - Date-related utilities
export const dateUtils = {
  getCurrentDate: () => new Date(),
  formatDate: (date: Date) => date.toISOString(),
  addDays: (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  },
};
```

**Method B: Direct exports (when closely related)**
```typescript
// ✅ ACCEPTABLE: Similar roles or needed together
// packages/uikit/src/ChatMessage/errors/types.ts
export const messageSendErrorCodes = {
  SEND_FAILED: "MSG_SEND_FAILED",
  NETWORK_ERROR: "MSG_SEND_NETWORK_ERROR",
} as const;

export type MessageSendErrorCode =
  (typeof messageSendErrorCodes)[keyof typeof messageSendErrorCodes];

export type MessageError = MessageSendError | MessageResendError | Error;

export type OnMessageErrorCallback = (args: {
  error: MessageError;
}) => void;
```

**Why is this allowed?**
- All serve a single role: "message error handling"
- Error code constants, types, and callbacks are used together
- External code imports these together when handling errors

**Real-world allowed cases** (examples only, not exhaustive):

*Case 1: types.ts files*
```typescript
// packages/uikit/src/ChatMessage/errors/types.ts
export const messageSendErrorCodes = { ... } as const;
export type MessageSendErrorCode = ...;
export type MessageError = ...;
export type OnMessageErrorCallback = ...;
```
→ Common domain: "message errors", used together

*Case 2: Provider + Hooks*
```typescript
// packages/uikit/src/ChatMessage/MessageProvider.tsx
export function MessageProvider({ children, onError }) { ... }
export const useMessageStateInternal = () => { ... }
export const useMessageActionsInternal = () => { ... }
```
→ Provider and hooks needed together for "message functionality"

*Case 3: Error class + Type guard*
```typescript
// packages/uikit/src/ChatMessage/errors/MessageSendError.ts
export class MessageSendError extends Error { ... }
export function isMessageSendError(error: unknown): error is MessageSendError { ... }
```
→ Error class and type guard always form a pair

**Decision criteria:**

✅ **Multiple exports allowed when:**
- Used together? (importing one often requires importing the others)
- Same role/domain? (share a common purpose or concern)
- Dependency relationship? (one item doesn't work without the others)

❌ **Multiple exports prohibited when:**
- Features are completely independent
- Items belong to different domains/concerns
- No reason to use them together

- The names of values that are elements of an object should be written so that they are naturally associated with the name of the object.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
export const user = { getUserName: "Timothy", };
user.getUserName;

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
export const user = { name: "Timothy", };

user.name;
```

- Functions that are elements of an object should have names that imply that they are functions.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
export const user = {
  name: () => {},
};

user.name();

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
export const user = {
  getUserName: () => {},
};

user.getUserName();
```

- The name of the function you export and the name of the file match.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// cachePolicy.ts
export const otherName = () => ({
  detailPage: {
    "Cache-Control": ["public", "s-maxage=0", "max-age=0"].join(", "),
  },
  listPage: {
    "Cache-Control": ["no-store", "no-cache", "must-revalidate"].join(", "),
  }
});

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// cachePolicy.ts
export const cachePolicy = () => ({
  detailPage: {
    "Cache-Control": ["public", "s-maxage=0", "max-age=0"].join(", "),
  },
  listPage: {
    "Cache-Control": ["no-store", "no-cache", "must-revalidate"].join(", "),
  }
});
```

- The parameters of all functions **MUST** be declared as destructed object.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
export function preprocessor(
  files,
  options = {},
): Promise<File[]> {
  return processFiles({ files, options });
}

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
type PreprocessorParams = {
  files: File[];
  options?: PreprocessorOptions;
};
export function preprocessor({
  files,
  options = {},
}: PreprocessorParams): Promise<File[]> {
  return processFiles({ files, options });
}
```

- **Exception: Type guards** — TypeScript type guard functions (`value is Type`) require the parameter name to match the `is` predicate. For type guards, plain parameters are allowed.
```typescript
// ✅ ACCEPTABLE: Type guard requires plain parameter for type narrowing
export function isResourceType(value: string): value is ResourceType {
  return RESOURCE_TYPES.has(value);
}
```

- **Exception: Exhaustiveness check helpers** — Helpers that exist to surface a `never` type at compile time (e.g., `assertNever`) take a single positional `never` parameter. The whole point is the call site `throw assertNever(value)` reading naturally; wrapping the value in an object adds noise without improving type safety. For these helpers, plain parameters are allowed.
```typescript
// ✅ ACCEPTABLE: Exhaustiveness check helper takes a plain never parameter
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}
```

- When refactoring a function or writing a replacement function, the interface (the type of the function's parameters and return values) MUST remain the same.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
/**
 * @deprecated MessagePrimaryKey.fromMessage()를 사용하세요
 */
export const getMessagePrimaryKey = ({
  message,
}: {
  message: {
    id: string;
    channelId: string;
  };
}): MessagePrimaryKey =>
  MessagePrimaryKey.fromMessage(message);

export const MessagePrimaryKey = {
  /**
   * 메시지 객체로부터 MessagePrimaryKey를 생성합니다
   * @throws {Error} id 또는 channelId가 없거나 빈 값일 경우
   */
  fromMessage(message: { id: string; channelId: string }): MessagePrimaryKey { // BROKEN interface
    // ...
    return MessagePrimaryKey.create({
      channelId: validatedMessage.output.message.channelId,
      messageId: validatedMessage.output.message.id,
    });
  },
};

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
/**
 * @deprecated MessagePrimaryKey.fromMessage()를 사용하세요
 */
export const getMessagePrimaryKey = ({
  message,
}: {
  message: {
    id: string;
    channelId: string;
  };
}): MessagePrimaryKey =>
  MessagePrimaryKey.fromMessage(message);

export const MessagePrimaryKey = {
  /**
   * 메시지 객체로부터 MessagePrimaryKey를 생성합니다
   * @throws {Error} id 또는 channelId가 없거나 빈 값일 경우
   */
  fromMessage({ message }: { message: { id: string; channelId: string }}): MessagePrimaryKey { // KEEP interface
    // ...
    return MessagePrimaryKey.create({
      channelId: validatedMessage.output.message.channelId,
      messageId: validatedMessage.output.message.id,
    });
  },
};
```

- The signature declaration of a function must be declared as destructed object.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
export type PreprocessorProgressCallback = (
  progress: number;
  currentFileIndex: number;
  totalFiles: number;
  stage: "heic_conversion" | "image_compression";
) => void;

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
export type PreprocessorProgressCallback = (args: {
  progress: number;
  currentFileIndex: number;
  totalFiles: number;
  stage: "heic_conversion" | "image_compression";
}) => void;
```

- You should write an "@fileoverview" comments at the **top of the file** where generic functions and hooks that are not React components are declared.
- "@fileoverview" comments are designed to guide readers unfamiliar with your code through the contents of this file. You can provide a description of the file contents and dependency or compatibility information, if any.
```typescript
/**
 * @fileoverview 메시지를 전송합니다.
 * 메시지를 전송하면 반환값을 optimistic update 합니다. 실제로 메시지가 서버에서 전송 처리 되어있지 않을수도 있지만, 유저에게 빠른 피드백을 제공할 수 있습니다.
 * 이 함수를 호출한 뒤, 서버와 동기화 하는 절차는 아래와 같습니다.
 * 1. 로컬 데이터에 이 함수를 통해 전송한 메시지 저장
 * 2. getMessages 함수를 호출해 반환된 마지막 메시지 id가 이 함수를 통해 로컬 데이터에 저장한 메시지 id와 같은지 검증
 * 3. 같지 않다면 exponential backoff 로직을 통해 최대 3회 getMessages 함수를 호출
 */

export async function sendMessage() {
  // ...
}
```
- All interface and function comments must conform to the style of the jsdoc.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
/**
 * 변환 설정 타입
 */
interface ConversionConfig {
  // 출력 포맷 (기본값: "image/jpeg")
  outputFormat: "image/jpeg" | "image/png";
  // 이미지 품질 (0-1, 기본값: 0.92)
  quality: number;
}

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
/**
 * 변환 설정 타입
 */
interface ConversionConfig {
  /** 출력 포맷
   * @default "image/jpeg"
   */
  outputFormat: "image/jpeg" | "image/png";
  /** 이미지 품질 (0-1)
   * @default 0.92
   */
  quality: number;
}
```

- Test code must exist for the function you are exporting, and you create a file containing the test code in the same path as the file where the function exists.
- Name the test file ${NAME_OF_THE_FILE_TO_BE_TESTED_WITHOUT_EXT}.spec.ts.
- The filename of the test code must contain the filename of the test target and include `spec`.
```
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
cachePolicy.ts
cachePolicy.test.ts

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
cachePolicy.ts
cachePolicy.spec.ts
```

## 2. node.js
- Follow the best practices in "node.js" v24.
- If you need to implement a stream as a pipe, be sure to use the pipeline function.
```ts
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
fs.createReadStream(path.resolve(regionCsvPath)).pipe(csvParser())

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
pipeline(
  fs.createReadStream(path.resolve(regionCsvPath)),
  csvParser(),
  (err) => {
    if (err) {
      console.error("Pipeline failed.", err);
    }
  },
);
```

- If you need to implement a callback function, use promisify function to avoid passing a callback.
```ts
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
getRegionByCoord({}, (err, data) => {
  // ...
})

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
import { promisify } from "node:util";

const getRegionByCoord = promisify<
  GetRegionByCoordReq,
  GetRegionByCoordRes
>(gRPCClient.getRegionByCoord.bind(gRPCClient));

try {
  await getRegionByCoord();
} catch {
  // ...
}
```

- Use the async ~ await syntax.

- **NEVER CREATE BARREL FILES** except for the package's top-level index.ts. Barrel files cause severe bundle bloat and build performance degradation.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION AND CAUSE PERFORMANCE ISSUES
// src/utils/index.ts - DO NOT CREATE THIS
export { createUniqueId } from "./createUniqueId";
export { formatTimestamp } from "./formatTimestamp";
export { safeWith } from "./safeWith";

// Any directory-level index.ts except package root
// src/channel/index.ts - DO NOT CREATE THIS
// src/errors/index.ts - DO NOT CREATE THIS
// src/redux/index.ts - DO NOT CREATE THIS

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// Import directly from source files
import { createUniqueId } from "./utils/createUniqueId";
import { formatTimestamp } from "./utils/formatTimestamp";
import { safeWith } from "./utils/safeWith";

// Only allowed barrel file: package root index.ts
// packages/core/src/index.ts - ONLY THIS IS ALLOWED
export { createChatStore } from "./redux/store";
export { UserEntity as User } from "./user/user.entity";
```

## 3. Control flow

- Don't use `else if`. Use guard clauses with early returns instead. A plain `if/else` (a single branch) is still allowed when the two paths are genuinely mutually exclusive.

```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
function getDiscountRate(user: User) {
  if (user.tier === "platinum") {
    return 0.3;
  } else if (user.tier === "gold") {
    return 0.2;
  } else if (user.tier === "silver") {
    return 0.1;
  } else {
    return 0;
  }
}

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
function getDiscountRate(user: User) {
  if (user.tier === "platinum") {
    return 0.3;
  }
  if (user.tier === "gold") {
    return 0.2;
  }
  if (user.tier === "silver") {
    return 0.1;
  }
  return 0;
}
```

- Don't nest `if` statements when an early return can flatten them — invert the outer condition into a guard clause and return early. The `processOrder` example below collapses a three-level nest into sequential guards. A nested `if` is still fine only when it handles a genuinely separate sub-case that no early return can hoist out.

```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
function processOrder(order: Order) {
  if (order.status === "valid") {
    if (order.items.length > 0) {
      if (order.payment.verified) {
        chargeCustomer({ order });
        sendConfirmation({ order });
      }
    }
  }
}

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
function processOrder(order: Order) {
  if (order.status !== "valid") {
    return;
  }
  if (order.items.length === 0) {
    return;
  }
  if (!order.payment.verified) {
    return;
  }
  chargeCustomer({ order });
  sendConfirmation({ order });
}
```

- A `switch ~ case` statement MUST have a `default` clause that throws via the `assertNever(value: never): never` helper. This makes the exhaustiveness check fail at compile time when a new union member is added later. The helper is provided by `@daangn/rocket-chat-web-sdk-core` (`packages/core/src/utils/assertNever.ts`); import it instead of redefining it.

```typescript
import { assertNever } from "@daangn/rocket-chat-web-sdk-core";
```

```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
type SendingStatus = "pending" | "sent" | "failed";

function getStatusLabel({ status }: { status: SendingStatus }): string {
  switch (status) {
    case "pending":
      return "전송 중";
    case "sent":
      return "전송 완료";
    default:
      return "알 수 없음"; // default가 fallback을 반환 → "failed" 같은 미처리 case가 조용히 흡수되고, 새 union 멤버가 추가되어도 컴파일러가 잡지 못함
  }
}

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
import { assertNever } from "@daangn/rocket-chat-web-sdk-core";

type SendingStatus = "pending" | "sent" | "failed";

function getStatusLabel({ status }: { status: SendingStatus }): string {
  switch (status) {
    case "pending":
      return "전송 중";
    case "sent":
      return "전송 완료";
    case "failed":
      return "전송 실패";
    default:
      throw assertNever(status);
  }
}
```

- **Exception**: When using a third-party library that prescribes its own switch convention (e.g., a Redux reducer's `default` returns the current state to ignore unknown actions), follow the library's recommended pattern instead.

```typescript
// ✅ ACCEPTABLE: Redux reducer follows the library convention
type CounterAction =
  | { type: "increment" }
  | { type: "decrement" };

function counterReducer(state: number, action: CounterAction): number {
  switch (action.type) {
    case "increment":
      return state + 1;
    case "decrement":
      return state - 1;
    default:
      return state; // Redux 권장 패턴: unknown action은 현재 state 반환
  }
}
```

## 4. Module dependencies

- **Never create circular dependencies between modules.** Circular dependencies cause unpredictable module initialization order (TDZ errors on `const`/`class` references), break tree-shaking, and produce runtime errors that depend on which entry point loads first. They almost always indicate a layering mistake — fix the layering, do not work around the cycle with lazy imports or `import type`.
- **The module that owns the data exports the type.** Consumers import the type from the owner — never the reverse. This makes the dependency direction one-way and matches the runtime direction of the data flow.

```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// ChatMessage.ts
import type { MessageErrorContext } from "./messageErrorHandler";

export type ChatMessage = {
  id: string;
  errorContext?: MessageErrorContext;
};

// messageErrorHandler.ts
import type { ChatMessage } from "./ChatMessage";

export type MessageErrorContext = {
  sourceMessageId: ChatMessage["id"];
};

export function handleMessageError({ message }: { message: ChatMessage }) {
  // ...
}
```

**Why is this wrong?**
- `ChatMessage.ts` imports from `messageErrorHandler.ts`, which imports back from `ChatMessage.ts` — a 2-module cycle.
- Module evaluation order is non-deterministic at the cycle edge; one side's exports can be `undefined` at the moment the other side reads them.
- Even if today's code happens to evaluate in a working order, adding any consumer between them flips the order and breaks production.

```typescript
// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// `ChatMessage` is the owner of the message data, so it exports the type.
// `messageErrorHandler` consumes `ChatMessage`. The arrow points one way only.

// ChatMessage.ts
export type ChatMessage = {
  id: string;
};

// messageErrorContext.ts
import type { ChatMessage } from "./ChatMessage";

export type MessageErrorContext = {
  sourceMessageId: ChatMessage["id"];
};

// messageErrorHandler.ts
import type { ChatMessage } from "./ChatMessage";
import type { MessageErrorContext } from "./messageErrorContext";

export function handleMessageError({
  message,
  context,
}: {
  message: ChatMessage;
  context: MessageErrorContext;
}) {
  // ...
}
```

- **When two modules genuinely reference each other's types, the shared type belongs in a third, dependency-free module that both import from.** Do not "solve" the cycle by moving types back and forth between the two modules — extract the shared vocabulary into a leaf module that imports nothing from the domain.

```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// channel.ts imports User from user.ts
// user.ts imports Channel from channel.ts  ← cycle

// channel.ts
import type { User } from "./user";

export type Channel = {
  id: string;
  memberIds: User["id"][];
};

// user.ts
import type { Channel } from "./channel";

export type User = {
  id: string;
  subscribedChannelIds: Channel["id"][];
};
```

```typescript
// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// ids.ts is a leaf module: it imports nothing from the domain.
// Both `channel.ts` and `user.ts` depend on `ids.ts` only.

// ids.ts
export type UserId = string & { readonly __brand: "UserId" };
export type ChannelId = string & { readonly __brand: "ChannelId" };

// channel.ts
import type { ChannelId, UserId } from "./ids";

export type Channel = {
  id: ChannelId;
  memberIds: UserId[];
};

// user.ts
import type { ChannelId, UserId } from "./ids";

export type User = {
  id: UserId;
  subscribedChannelIds: ChannelId[];
};
```

- **`import type { ... }` is not a license to introduce cycles.** Type-only imports are erased at compile time, but the file is still parsed and the cycle still shows up in the dependency graph that tooling (bundlers, language servers, lint rules) and humans read. If `import type` is the only thing keeping a cycle from breaking at runtime, the layering is wrong — extract a shared module instead.
