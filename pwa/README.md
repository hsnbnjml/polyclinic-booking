# pwa/ — the installable app shell

The real app runs on `script.google.com`, and Google owns that page: its tab icon, its
browser chrome, its "no manifest" policy — and the "created by a Google Apps Script user"
attribution bar it forces above the app. So the app is **not** installed from there.
This folder is a tiny page we do own. It loads the live app in a full-screen iframe and
adds everything a phone needs to install it as an app:

- `manifest.webmanifest` — app name, icon, standalone window (no browser bars)
- `icons/` — 192/512/maskable PNGs + the Apple touch icon; `icons/icon.svg` is the source
  (a placeholder "medical plus" in the clinic teal — when the doctor hands over the real
  logo, replace `icon.svg` and re-render the PNGs at the same sizes)
- `index.html` — the shell itself; it forwards query parameters for patient campaign links
- `_redirects` — accepts both `/staff` and `/staff/` (and `/admin`) on Cloudflare Pages

The builder creates three entries from the same shell:

| Path | Opens |
|---|---|
| `/` | patient booking; campaign parameters are forwarded |
| `/staff/` | reception screen (`?page=staff`) |
| `/admin/` | admin settings and doctor PIN login (`?page=admin`) |

The staff and admin entries have their own manifest, `start_url`, scope and icon label, so
installing from `/staff/` opens the reception screen on launch, and installing from
`/admin/` opens the settings screen on launch. Patients do not need to install anything.
Doctors use the `/admin/` entry and log in with their PIN; the server scopes them to their
own reasons and schedule.

## The live URL never lives in git

`index.html` contains an `__APP_URL__` placeholder on purpose. The public repository must
never carry the live booking URL. The builder fills it from the git-ignored
`apps-script/.clasp.json` (its `deploymentId`):

```powershell
node tools/build-pwa.mjs     # writes dist/pwa/ with the real URL baked in
```

Then upload the **`dist/pwa`** folder to any static host. The recommendation is
**Cloudflare Pages** (free, no card, allows commercial use): create an account at
`dash.cloudflare.com`, choose *Workers & Pages → Create → Pages → Upload assets*, drop
the folder in. Netlify Drop works the same way. GitHub Pages of this repository is *not*
the place for it (its terms exclude business sites; the demo here is fine because it is
an offline demo).

## Installing on a phone (what to tell the clinic team)

Only staff and doctors install the app; patients open the plain link.

- **Android (Chrome):** open `/staff/` for reception or `/admin/` for admin/doctor →
  menu (⋮) → **إضافة إلى الشاشة الرئيسية / تثبيت التطبيق**. The app opens without browser
  bars and shows in the app drawer.
- **iPhone (Safari):** open the same short URL → Share button → **إضافة إلى الشاشة
  الرئيسية**. (Must be Safari; Chrome on iOS cannot add to the home screen.)

Do not install from `/staff?page=...` or with an old query link; use the path shown above.
The dedicated manifest keeps the correct screen as the launch page.

## If Google blocks the embedded app

A Work Google account or managed browser can block Apps Script even when the raw
`/exec` link is public. The app sends a `polyclinic-ready` message once its HTML runs;
the shell hides its load cover only for that message, not for Google's error page. If
the message does not arrive within two seconds, a small note appears:

> **لا يظهر التطبيق؟** جرّب فتح الرابط في متصفح آخر، أو اتصل برقم الاستقبال مباشرة:  
> `[رقم الاستقبال]`

The note is rendered by Cloudflare outside the iframe, so it remains visible over
Google's error page. It disappears automatically if the app finishes loading later.

## Why the shell also looks cleaner

Google renders its "created by a Google Apps Script user / report abuse" bar only when the
app page is opened top-level. Inside this shell the bar is not rendered at all (measured
live: 25px bar on the raw link, 0 inside the shell), so the framed app — and anything
installed from it — looks fully branded. The raw `…/exec` link still shows the bar; that is
Google's page and no setting removes it, so share the **shell URL** (and print it into the
QR codes) instead.

## Regenerating after any app change

The shell needs no rebuild when the app changes (it frames the live URL). Re-run
`node tools/build-pwa.mjs` only if files in this folder change, then re-upload.
