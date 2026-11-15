# Chrome Web Store listing: Koi Pond Simulator 1.0.0

Everything the Developer Dashboard asks for, ready to paste. The package is
`release/koi-pond-simulator-<version>.zip` (`npm run zip`); the images are in this folder
(`npm run store` renders them again).

## Replacing the 2019 listing

Version 1.0.0 is a rebuild of the old Manifest V2 *Koi Pond Simulator* (0.0.1), which Chrome took
down when it dropped Manifest V2. To keep the same listing, its users and its ID: open that item in
the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), **Package → Upload new
package**, pick the zip, update the tabs below, and **Submit for review**. (The version only has to
be higher than 0.0.1. If the old item was deleted rather than taken down, add a new item instead.)

## Store listing tab

**Name** (from the manifest): Koi Pond Simulator

**Summary** (from the manifest, 132 characters at most):
A living koi pond on every new tab, or a coral reef or mountain stream, by day or night. Optional clock and search.

**Description**:

```
Open a new tab onto water. Koi Pond Simulator turns Chrome's new tab page into a living scene to glance at between tasks.

• Koi pond: koi with procedurally patterned bodies in a dozen classic varieties (kohaku, sanke, showa, ogon and more), gliding under water lilies while light rain rings the surface.
• Coral reef: a school of reef fish, and the odd predator, over soft cascading shelf coral under shimmering foam.
• Mountain stream: salmon holding in the current behind boulders, with maple leaves and foam carried downstream.

Every scene has a day and a night palette. Let it follow your clock (with day and night times you can set), or pick one. The fish swim away from your cursor.

An optional clock and search box (it searches with your default search engine). Your settings sync between your computers through your Chrome account.

No accounts, no ads, no tracking: the extension collects no data and makes no network requests of its own.

New in 1.0: rebuilt from scratch, with three scenes, day and night, a clock, search and settings.
```

**Category**: Fun (or Art & Design, whichever the dashboard offers)

**Language**: English

**Graphic assets**:

- Store icon: from the package (`public/icons/icon128.png`)
- Screenshots (1280x800): `screenshots/1-pond-day.png` … `screenshots/5-reef-night.png`
- Small promo tile (440x280): `promo-440x280.png`

## Privacy practices tab

**Single purpose**:

```
Replaces the new tab page with an animated water scene (a koi pond, coral reef or mountain stream), with an optional clock and search box.
```

**Permission justification**:

- `storage`:
  ```
  Saves the user's settings (scene, time of day, and whether the clock and search box show) with chrome.storage.sync, so they persist and follow the user between their computers.
  ```
- `search`:
  ```
  The optional search box on the new tab page sends the user's query to their default search engine through chrome.search.query, rather than to a fixed provider.
  ```

**Remote code**: No, I am not using remote code. (Everything is bundled in the package.)

**Data usage**: tick none of the data types (it collects none), then tick all three certifications
(not sold to third parties, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL**: if the dashboard asks for one, link to `store/privacy-policy.md` on GitHub.
