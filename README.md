# Stash+

Stash+ is a plugin for [Stash](https://github.com/stashapp/stash) that adds achievements, rankings, statistics and recommendations on top of your library. It reads everything from your own Stash instance through its GraphQL API. Nothing is sent anywhere else.

An optional companion plugin, [Stash+ O Ratings](https://github.com/stashplus/stashoratings), lets you rate and comment on each individual O. Stash+ uses that data for the O Ratings tab, the O rating achievements and the day view in the Monthly Breakdown. Stash+ works fine without it.

## Features

The Stash+ page has these tabs:

- **🏆 Achievements**: hundreds of achievements across scenes, performers, studios and tags, ratings, organization, library, playback, O counter, timing, variety, performer completion, performer networks and more. Each has a tier (easy, medium, hard) and a progress bar. Unlocked ones can be clicked to see the scene, performer or list behind them. Filter by completed or missing, or sort by recently unlocked.
- **👑 Performer of the Year**: a podium and full ranking of performers by year or all time, with a score breakdown per performer.
- **🗓️ Monthly Breakdown**: the same ranking for a single month, plus a calendar where each day shows its O count. Click a day to see its scenes (with the vote and comment of each O if you use the companion plugin).
- **🏢 Studios**: studio rankings by year, month or all time.
- **🔮 For You**: scene recommendations built from the performers and studios you O the most, with optional tag boosts and a rewatch mode.
- **📈 Stats**: library growth, time from adding a scene to its first O, streaks, a yearly heatmap, an hour-of-day heatmap, rewatch ratio trend, per-performer monthly analysis and a diversity breakdown.
- **⭐ O Ratings**: stats, a rating distribution you can click to filter, and a best-to-worst (or worst-to-best) ranking of every rated O. Requires the companion plugin.

## Installation

### From the plugin source (recommended)

1. In Stash, go to **Settings → Plugins → Available Plugins**.
2. Click **Add Source** and fill in:
   - **Name:** `Stash+`
   - **Source URL:** `https://stashplus.github.io/stashplus/index.yml`
   - **Local Path:** `stashplus`
3. Expand the new source, tick **Stash+** and click **Install**.
4. Hard-refresh the page (Ctrl+F5). A **➕ Stash+** link appears in the navbar.

Stash will offer updates here when a new version is released.

### Manual

Copy the `stashPlus` folder from this repo into the `plugins` folder of your Stash configuration directory (next to `config.yml`), then go to **Settings → Plugins**, click **Reload Plugins** and hard-refresh the page.

## Notes and limitations

- Use a recent Stash release. Stash+ uses the plugin UI API (`PluginApi`) and Stash's O history. Timing-based features and the O Ratings tab need scenes that have O history.
- **Time zone:** all time-of-day and date logic (night owl, weekday, holiday achievements, heatmaps) currently uses the `Europe/Rome` time zone. To change it, search for `Europe/Rome` in `stashPlus/stashPlus.js` and replace it with your own [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
- Tag achievements look up tags by name (for example `creampie`, `anal`, `outdoor`) with a partial match. Achievements for tags you do not have simply stay at zero.
- Height and weight achievements are relative to your own library (median, top and bottom 10%, record holders), not fixed values.
- Unlocked achievements and collapsed sections are remembered in your browser's local storage, so they are per browser.
- On very large libraries the first load of the Achievements and Stats tabs can take a few seconds, because they scan scenes and performers.

## Repository layout

```
stashPlus/            plugin source (stashPlus.yml, stashPlus.js, stashPlus.css)
docs/index.yml        plugin source index that Stash reads
docs/stashPlus.zip    packaged plugin that the index points to
build.py              rebuilds the zip and index
```

## Releasing a new version

1. Edit the files in `stashPlus/` and bump `version` in `stashPlus/stashPlus.yml`.
2. Run `python3 build.py stashPlus` from the repo root. It rebuilds `docs/stashPlus.zip` and rewrites `docs/index.yml` with the new version, date and checksum.
3. Commit and push. GitHub Pages serves the new files, and Stash shows an update.

The `docs/index.yml` checksum must match `docs/stashPlus.zip` exactly, so always commit the two together and never edit the zip by hand.

## Publishing with GitHub Pages (one-time setup)

In the repo, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose branch `main` and folder `/docs`, and save. After a minute the index is available at `https://stashplus.github.io/stashplus/index.yml`.
