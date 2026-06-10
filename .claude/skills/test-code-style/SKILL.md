---
name: test-code-style
description: 테스트 코드 작성, spec 파일 생성, 테스트 케이스 추가 시 반드시 적용해야 하는 테스트 코드 스타일 가이드라인. 모든 테스트 코드 작업에 이 스킬을 사용하세요.
---

# Test code style

## 1. Basic principles of writing test code

- Test code must exist for the function you are exporting, and you create a file containing the test code in the same path as the file where the function exists.
- Functions that don't export are considered private, and you shouldn't write test cases for them.
- Write the test code with a goal of 100% branch coverage.
- Write all descriptions in Korean, except for the name of the file under test and the function under test.
- If you have code that depends on an external module and requires mocking:
  - Do not use mocking.
  - You MUST propose code improvements to using dependency injection instead of mocking.

## 2. Code style
- vitest has the globals: true option set, so you don't need to import vitest's functions.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// cachePolicy.spec.ts
import { describe, expect, it } from "vitest";

describe("cachePolicy에 대한 테스트 케이스", () => {
  // ...
})

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// cachePolicy.spec.ts
describe("cachePolicy", () => {
  // ...
})
```

- The top-level description of the test code is the filename of the test target.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// cachePolicy.spec.ts
describe("cachePolicy에 대한 테스트 케이스", () => {
  // ...
})

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// cachePolicy.spec.ts
describe("cachePolicy", () => {
  // ...
})
```

- The test cases for the functions you export from the file under test must all be included in the top-level describe function.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// cachePolicy.spec.ts
describe("parse", () => {
  // ...
})

describe("toString", () => {
  // ...
})

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// cachePolicy.spec.ts
describe("cachePolicy", () => {
  describe("parse", () => {
    // ...
  })

  describe("toString", () => {
    // ...
  })
})
```

- If you need to branch conditions in your test code, use the `context` function.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// cachePolicy.spec.ts
describe("cachePolicy", () => {
  describe("parse", () => {
    describe("isInvalid가 true인 경우", () => {
      // ...
    })

    describe("isInvalid가 false인 경우", () => {
      // ...
    })
  })
})

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// cachePolicy.spec.ts
const context = describe;

describe("cachePolicy", () => {
  describe("parse", () => {
    context("isInvalid가 true인 경우", () => {
      // ...
    })

    context("isInvalid가 false인 경우", () => {
      // ...
    })
  })
})
```

- Use the `test.each` function if you need to test for multiple parameters in one function under test.
```typescript
// ❌ NEVER GENERATE THIS CODE - IT WILL BREAK THE APPLICATION
// cachePolicy.spec.ts
describe("parsePriceParams", () => {
  test("search params의 `price`를 input 상태로 쓸 수 있게 알맞게 파싱합니다.", () => {
    [["0__200", { from: "0", to: "200" }],
    ["10__200", { from: "10", to: "200" }],
    ["__200", { from: "", to: "200" }],
    ["10__", { from: "10", to: "" }],
    ["Free", { from: "0", to: "0" }],].forEach(([input, expected]) => {
      expect(parsePriceParams(input)).toEqual(expected);
    })
    },
  );
});

// ✅ ALWAYS GENERATE THIS EXACT PATTERN
// cachePolicy.spec.ts
describe("parsePriceParams", () => {
  test.each([
    ["0__200", { from: "0", to: "200" }],
    ["10__200", { from: "10", to: "200" }],
    ["__200", { from: "", to: "200" }],
    ["10__", { from: "10", to: "" }],
    ["Free", { from: "0", to: "0" }],
  ])(
    "search params의 `price`를 input 상태로 쓸 수 있게 알맞게 파싱합니다.",
    (input, expected) => {
      expect(parsePriceParams(input)).toEqual(expected);
    },
  );
});
```

## 3. Assertion integrity

- **Tests must verify intent, not implementation.** Before writing an assertion, first define: "Under what condition should this test fail?" If you cannot define a failure condition, the test has no value.
- **Tautological tests are prohibited.** If you repeat the implementation logic inside the test, the test will pass even when the implementation is wrong. The expected value in an assertion must be derived independently of the implementation.

```typescript
// ❌ Assertion duplicates the implementation — always passes even if the implementation is wrong
test("메시지 ID가 정렬된 순서로 반환된다", () => {
  const ids = getChannelMessageIds(state, channelId);
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  expect(ids).toEqual(sorted); // ids is already the result of sort(), so this always passes
});

// ✅ Intent-based assertion — verifies that store insertion order is preserved
test("메시지 ID가 store 삽입 순서대로 반환된다", () => {
  const ids = getChannelMessageIds(state, channelId);
  expect(ids).toEqual(["msg-3", "msg-1", "msg-2"]); // expected value explicitly stated by test author
});
```
