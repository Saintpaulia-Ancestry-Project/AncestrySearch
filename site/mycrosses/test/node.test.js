// Runs the shared suite in Node against in-memory storage:  node --test site/mycrosses/test/
import test from "node:test";
import assert from "node:assert/strict";
import { defineTests } from "./suite.js";
import { MemoryAdapter } from "../js/core/adapters/memory.js";

defineTests({ test, assert, makeAdapter: async () => new MemoryAdapter() });
