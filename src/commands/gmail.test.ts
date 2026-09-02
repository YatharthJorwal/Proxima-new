/**
 * Mocks the `googleapis` module directly (same "mock the boundary, not
 * the function under test" approach as systemUsage.test.ts mocking
 * child_process.spawn) - exercises the real header-parsing/summary logic
 * against a fake Gmail API client, not by mocking fetchRecentEmails()
 * itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockList, mockGet } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      // A plain function (not an arrow function) so `new google.auth.OAuth2(...)`
      // works the way real construction does - arrow functions have no
      // [[Construct]] internal slot and throw "is not a constructor" if
      // vi.fn().mockImplementation() wraps one instead.
      OAuth2: vi.fn().mockImplementation(function MockOAuth2() {
        return { setCredentials: vi.fn() };
      }),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        messages: {
          list: mockList,
          get: mockGet,
        },
      },
    }),
  },
}));

import { fetchRecentEmails, executeGetEmails, GmailNotConfiguredError } from "./gmail";

const ENV_KEYS = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] as const;

function setConfigured() {
  process.env.GMAIL_CLIENT_ID = "test-client-id";
  process.env.GMAIL_CLIENT_SECRET = "test-client-secret";
  process.env.GMAIL_REFRESH_TOKEN = "test-refresh-token";
}

function headerMessage(id: string, from: string, subject: string, date: string, snippet: string) {
  return {
    data: {
      snippet,
      payload: {
        headers: [
          { name: "From", value: from },
          { name: "Subject", value: subject },
          { name: "Date", value: date },
        ],
      },
    },
  };
}

beforeEach(() => {
  mockList.mockReset();
  mockGet.mockReset();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("fetchRecentEmails", () => {
  it("throws GmailNotConfiguredError when credentials are missing", async () => {
    await expect(fetchRecentEmails()).rejects.toThrow(GmailNotConfiguredError);
  });

  it("returns an empty array when there are no matching messages", async () => {
    setConfigured();
    mockList.mockResolvedValue({ data: { messages: [] } });

    const result = await fetchRecentEmails("is:unread");
    expect(result).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("fetches metadata for each message and simplifies the From header", async () => {
    setConfigured();
    mockList.mockResolvedValue({ data: { messages: [{ id: "1" }, { id: "2" }] } });
    mockGet
      .mockResolvedValueOnce(
        headerMessage("1", '"Priya Shah" <priya@example.com>', "Invoice #204", "Mon, 1 Jan 2026 10:00:00", "Please find attached")
      )
      .mockResolvedValueOnce(headerMessage("2", "no-reply@service.com", "", "Mon, 1 Jan 2026 11:00:00", "Your receipt"));

    const result = await fetchRecentEmails(undefined, 5);
    expect(result).toEqual([
      { from: "Priya Shah", subject: "Invoice #204", date: "Mon, 1 Jan 2026 10:00:00", snippet: "Please find attached" },
      { from: "no-reply@service.com", subject: "(no subject)", date: "Mon, 1 Jan 2026 11:00:00", snippet: "Your receipt" },
    ]);
  });

  it("clamps maxResults to the 1-10 range", async () => {
    setConfigured();
    mockList.mockResolvedValue({ data: { messages: [] } });

    await fetchRecentEmails(undefined, 50);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 10 }));

    await fetchRecentEmails(undefined, 0);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 1 }));
  });
});

describe("executeGetEmails", () => {
  it("gives an actionable reply when Gmail isn't configured, not a generic failure", async () => {
    const reply = await executeGetEmails({});
    expect(reply).toMatch(/setup:gmail/);
  });

  it("gives an honest no-results reply for a query with no matches", async () => {
    setConfigured();
    mockList.mockResolvedValue({ data: { messages: [] } });

    const reply = await executeGetEmails({ query: "from:nobody@nowhere.com" });
    expect(reply).toContain("from:nobody@nowhere.com");
  });

  it("summarizes matching emails into a spoken-friendly reply", async () => {
    setConfigured();
    mockList.mockResolvedValue({ data: { messages: [{ id: "1" }] } });
    mockGet.mockResolvedValueOnce(
      headerMessage("1", "Priya Shah <priya@example.com>", "Invoice #204", "Mon, 1 Jan 2026", "Please find attached")
    );

    const reply = await executeGetEmails({});
    expect(reply).toContain("Priya Shah");
    expect(reply).toContain("Invoice #204");
  });

  it("gives an honest failure message instead of crashing on an unexpected error", async () => {
    setConfigured();
    mockList.mockRejectedValue(new Error("network down"));

    const reply = await executeGetEmails({});
    expect(reply).toMatch(/something went wrong/i);
  });
});
