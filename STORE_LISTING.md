# Chrome Web Store listing

## Product name

X FollowTidy

## Summary

Safely unfollow accounts on X for free, with follower filters and adjustable pacing.

## Detailed description

X FollowTidy is a local-first Chrome extension for safely tidying your X Following list.

Choose a follower-count limit, optionally protect people who follow you, and configure the delay, batch size, and cooldown. X FollowTidy checks each visible account, re-verifies the enabled safety rules immediately before unfollowing, and pauses automatically if X rejects or limits an action.

Key features:

- Start from any browser tab
- Filter by verified follower count
- Protect accounts that follow you
- Configure action delay, batch size, and cooldown
- Pause and continue from a live side panel
- Review scanned, kept, waiting, and unfollowed accounts
- Keep settings and history locally in Chrome
- No subscription or required payment

X FollowTidy is not affiliated with or endorsed by X Corp.

## Category

Productivity

## Single purpose

Help users review and safely unfollow accounts from their own X Following list using user-configured filters and pacing.

## Permission justifications

### `storage`

Stores cleanup settings, progress, scanned-account records, and history locally in Chrome.

### `unlimitedStorage`

Allows the local scanned-account history to grow without sending account data to a server.

### `tabs`

Opens the user-requested X Following page, tracks that worker tab, and stops safely if it is closed.

### `scripting`

Loads the scanner and safety-check worker into the selected X Following page when it is not already present.

### `sidePanel`

Displays live progress, settings, pause/continue controls, and scanned-account results beside X.

### Host access: `https://x.com/*`

Required to read visible Following-list and hover-card information and perform unfollow actions explicitly requested by the user.

## Data disclosure notes

- Processes website content from the user's X Following page.
- Stores account handles, visible profile metadata, scan results, settings, and history locally on the user's device.
- Does not transmit this data to the developer or any application server.
- Does not collect analytics, advertising identifiers, authentication credentials, payment information, or telemetry.
- Opens GitHub Sponsors only after the user explicitly clicks the optional donation link.

The Chrome Web Store privacy form and the published privacy policy must match these statements.

## Privacy policy URL

Before submission, publish [PRIVACY.md](PRIVACY.md) at a public HTTPS URL and enter that URL in the Chrome Web Store Privacy practices tab. The GitHub repository is currently private, so its file URL is not publicly accessible.

## Store graphics

- Store icon: `icons/icon-128.png`
- Screenshot: `store-assets/screenshot-1280x800.png`
- README showcase: `assets/x-followtidy-showcase.png`

The developer dashboard may also request a 440×280 small promotional tile. Keep its branding consistent with the current icon and screenshot.
