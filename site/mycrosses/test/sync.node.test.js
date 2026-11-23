// Runs the sync suite in Node against in-memory storage:  node --test site/mycrosses/test/
import test from "node:test";
import assert from "node:assert/strict";
import { defineSyncTests } from "./sync.suite.js";
import { MemoryAdapter } from "../js/core/adapters/memory.js";

defineSyncTests({ test, assert, makeAdapter: async () => new MemoryAdapter() });
