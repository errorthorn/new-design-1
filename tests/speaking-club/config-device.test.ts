import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserStubs, installFakeWorker } from "./helpers";
import { liveTranscriptionAllowed, modelSetupRequired, postCallWaitBudgetMs, whisperModelId, whisperRemoteHost } from "@/lib/speaking-club/config";
import { deviceCanRunWhisper, isIos, liveTranscriptionEnabled } from "@/lib/speaking-club/device";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("config", () => {
  it("has safe defaults", () => {
    expect(whisperModelId()).toBe("Xenova/whisper-tiny.en");
    expect(whisperRemoteHost()).toBeUndefined();
    expect(liveTranscriptionAllowed()).toBe(true);
    expect(modelSetupRequired()).toBe(true);
    expect(postCallWaitBudgetMs()).toBe(240_000);
  });

  it("reads overrides from NEXT_PUBLIC_* variables", () => {
    vi.stubEnv("NEXT_PUBLIC_WHISPER_MODEL", "Xenova/whisper-base.en");
    vi.stubEnv("NEXT_PUBLIC_WHISPER_REMOTE_HOST", "https://models.example.com/");
    vi.stubEnv("NEXT_PUBLIC_WHISPER_LIVE", "false");
    vi.stubEnv("NEXT_PUBLIC_WHISPER_SETUP_REQUIRED", "false");
    vi.stubEnv("NEXT_PUBLIC_WHISPER_MAX_WAIT_SEC", "90");
    expect(whisperModelId()).toBe("Xenova/whisper-base.en");
    expect(whisperRemoteHost()).toBe("https://models.example.com/");
    expect(liveTranscriptionAllowed()).toBe(false);
    expect(modelSetupRequired()).toBe(false);
    expect(postCallWaitBudgetMs()).toBe(90_000);
  });

  it("ignores a nonsense wait budget", () => {
    vi.stubEnv("NEXT_PUBLIC_WHISPER_MAX_WAIT_SEC", "abc");
    expect(postCallWaitBudgetMs()).toBe(240_000);
  });
});

describe("device gates", () => {
  it("runs live transcription on every device, weak ones included", () => {
    installBrowserStubs({ hardwareConcurrency: 8, deviceMemory: 8 });
    expect(liveTranscriptionEnabled()).toBe(true);
    installBrowserStubs({ hardwareConcurrency: 2, deviceMemory: 2 });
    expect(liveTranscriptionEnabled()).toBe(true);
    installBrowserStubs({ hardwareConcurrency: 8 }); // Safari/Firefox don't report memory
    expect(liveTranscriptionEnabled()).toBe(true);
  });

  it("respects the NEXT_PUBLIC_WHISPER_LIVE=false switch", () => {
    installBrowserStubs({ hardwareConcurrency: 8, deviceMemory: 8 });
    vi.stubEnv("NEXT_PUBLIC_WHISPER_LIVE", "false");
    expect(liveTranscriptionEnabled()).toBe(false);
  });

  it("rules out only devices that clearly cannot run the model", () => {
    installFakeWorker(); // Node has no Worker of its own
    installBrowserStubs();
    expect(deviceCanRunWhisper()).toBe(true);
    installBrowserStubs({ deviceMemory: 0.5 });
    expect(deviceCanRunWhisper()).toBe(false);
    vi.stubGlobal("AudioContext", undefined);
    installBrowserStubs();
    vi.stubGlobal("AudioContext", undefined);
    expect(deviceCanRunWhisper()).toBe(false);
  });

  it("detects iOS including iPadOS", () => {
    installBrowserStubs({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    expect(isIos()).toBe(true);
    installBrowserStubs({ userAgent: "Mozilla/5.0 (Linux; Android 14)" });
    expect(isIos()).toBe(false);
  });
});
