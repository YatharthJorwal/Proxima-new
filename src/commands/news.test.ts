import { describe, expect, it } from "vitest";
import { itemImage, parseFeed } from "./news";

const item = (inner: string) => `<rss><channel><item><title>Headline</title><link>https://example.com/a</link><pubDate>Mon, 01 Jan 2026 10:00:00 GMT</pubDate><description><![CDATA[Summary <b>text</b>]]></description>${inner}</item></channel></rss>`;

describe("news feed parsing", () => {
  it("takes the thumbnail from media:thumbnail", () => {
    const [n] = parseFeed(item('<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/abc.jpg"/>'), "BBC");
    expect(n.image).toBe("https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/abc.jpg");
    expect(n).toMatchObject({ title: "Headline", link: "https://example.com/a", summary: "Summary text", source: "BBC" });
  });

  it("accepts image enclosures and media:content images, decoding &amp;", () => {
    expect(itemImage('<enclosure url="https://x.test/p.png?a=1&amp;b=2" type="image/png" length="1"/>')).toBe("https://x.test/p.png?a=1&b=2");
    expect(itemImage('<media:content url="https://x.test/m.jpg" medium="image"/>')).toBe("https://x.test/m.jpg");
  });

  it("ignores audio/video enclosures and non-https or malformed image URLs", () => {
    expect(itemImage('<enclosure url="https://x.test/a.mp3" type="audio/mpeg"/>')).toBe("");
    expect(itemImage('<media:content url="https://x.test/v.mp4" medium="video"/>')).toBe("");
    expect(itemImage('<media:thumbnail url="http://x.test/insecure.jpg"/>')).toBe("");
    expect(itemImage('<media:thumbnail url="javascript:alert(1)"/>')).toBe("");
    expect(itemImage('<media:thumbnail url="not a url"/>')).toBe("");
  });

  it("falls through to a later usable image and returns an empty string when there is none", () => {
    expect(itemImage('<media:thumbnail url="http://bad.test/x.jpg"/><media:thumbnail url="https://ok.test/y.jpg"/>')).toBe("https://ok.test/y.jpg");
    expect(parseFeed(item(""), "BBC")[0].image).toBe("");
  });

  it("drops items without an https link", () => {
    const xml = '<item><title>A</title><link>http://insecure.test/a</link></item><item><title>B</title><link>https://ok.test/b</link></item>';
    expect(parseFeed(xml, "S").map((n) => n.title)).toEqual(["B"]);
  });
});
