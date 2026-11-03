// The real model, on the CPU, from local files. Nothing is uploaded and no model API is called.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as tf from "@tensorflow/tfjs";
import { transcribeFile } from "./transcribe";

beforeEach(async () => {
  await tf.setBackend("cpu");
  await tf.ready();
  const samples = new Float32Array(22050 * 3);
  vi.stubGlobal("OfflineAudioContext", class {
    async decodeAudioData() {
      return { length: samples.length, numberOfChannels: 1, duration: 3, getChannelData: () => samples };
    }
  });
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(String(url), "http://local.test").pathname;
    expect(path).toMatch(/^\/transcribe\/(model.json|group1-shard1of1.bin)$/);
    return new Response(readFileSync(`public${path}`), { status: 200 });
  });
});
afterEach(() => {
  // This file owns its CPU backend, so a failed assertion can't carry a leak into the next test.
  tf.engine().reset();
  vi.unstubAllGlobals();
});

const file = (name: string) => new File(["local audio fixture"], name);

it("lets go of the model and everything it worked out after each import", async () => {
  const before = tf.memory().numTensors;
  await transcribeFile(file("one.wav"), () => {});
  expect(tf.memory().numTensors).toBe(before);
  await transcribeFile(file("two.wav"), () => {});
  expect(tf.memory().numTensors).toBe(before);
}, 120_000);

it("lets go of them too when a listen is stopped partway", async () => {
  const before = tf.memory().numTensors;
  const stopped = transcribeFile(file("old.wav"), () => {
    throw new Error("Something newer was opened.");
  });
  await expect(stopped).rejects.toThrow("newer");
  expect(tf.memory().numTensors).toBe(before);
}, 120_000);

it("takes two listens one after the other, even if the first is stopped", async () => {
  const before = tf.memory().numTensors;
  const order: string[] = [];
  const first = transcribeFile(file("old.wav"), () => {
    order.push("old");
    throw new Error("Something newer was opened.");
  });
  const second = transcribeFile(file("new.wav"), () => order.push("new"));
  await expect(first).rejects.toThrow("newer");
  await expect(second).resolves.toMatchObject({ seconds: 3 });
  expect(order[0]).toBe("old");
  expect(order.filter((o) => o === "old")).toHaveLength(1);
  expect(tf.memory().numTensors).toBe(before);
}, 120_000);
