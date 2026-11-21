# Stash+

Stash+ is a plugin for [Stash](https://github.com/stashapp/stash) that adds achievements, rankings, statistics and recommendations on top of your library. It reads everything from your own Stash instance through its GraphQL API. Nothing is sent anywhere else.

The repo contains two plugins that work together:

| Plugin | Folder | What it does |
| --- | --- | --- |
| **Stash+** | `stashPlus/` | The main plugin: a new **Stash+** page in the navbar with all the tabs below. |
| **Stash+ O Ratings** | `stashOratings/` | Optional companion: lets you rate and comment on each individual O. Stash+ uses this data for the O Ratings tab, the O rating achievements and the day view in the Monthly Breakdown. |

Stash+ works on its own. Install the companion only if you want per-O ratings.

## Features

The Stash+ page has these tabs:

- **🏆 Achievements**: Hundreds of achievements across scenes, performers, studios and tags, ratings, organization, library, playback, O counter, timing, variety, performer completion, performer networks and more. Each has a tier (easy, medium, hard) and a progress bar. Unlocked ones can be clicked to see the scene, performer or list behind them. Filter by completed or missing, or sort by recently unlocked.
- **👑 Performer of the Year**: a podium and full ranking of performers by year or all time, with a score breakdown per performer.
- **🗓️ Monthly Breakdown**: the same ranking for a single month, plus a calendar where each day shows its O count. Click a day to see its scenes (with the vote and comment of each O if you use the companion plugin).
- **🏢 Studios**: studio rankings by year, month or all time.
- **🔮 For You**: scene recommendations built from the performers and studios you O the most, with optional tag boosts and a rewatch mode.
- **📈 Stats**: library growth, time from adding a scene to its first O, streaks, a yearly heatmap, an hour-of-day heatmap, rewatch ratio trend, per-performer monthly analysis and a diversity breakdown.
- **⭐ O Ratings**: stats, a rating distribution you can click to filter, and a best-to-worst (or worst-to-best) ranking of every rated O. Requires the companion plugin.

### Stash+ O Ratings (companion)

- After you press the O button on a scene, a small popup asks for a rating (0–10) and an optional comment.
- The scene's **History** tab shows each O's rating and comment next to it, and lets you edit them.
- Ratings are independent of the scene rating. By default, nothing happens to a scene's first O.
- **Settings → Plugins** has a button, *Set first O ratings from scene ratings*, that does a one-time copy of each scene's current rating onto its first O. It is a snapshot, not a link: later changes to the scene rating do not change it, and existing first-O ratings are never overwritten.
- Data is stored in the plugin's own configuration in Stash.

## Installation

1. Find your Stash configuration directory (the folder that contains `config.yml`) and open its `plugins` folder. Create it if it does not exist.
2. Copy the folders from this repo into it:
   ```
   plugins/
   ├── stashPlus/
   │   ├── stashPlus.yml
   │   ├── stashPlus.js
   │   └── stashPlus.css
   └── stashOratings/          (optional companion)
       ├── stashOratings.yml
       └── stashOratings.js
   ```
3. In Stash, go to **Settings → Plugins** and click **Reload Plugins**.
4. Both plugins should now be listed. Refresh the page (a hard refresh, Ctrl+F5, avoids stale cached scripts). A **➕ Stash+** link appears in the navbar.

To update, replace the files and reload plugins again.

## Notes and limitations

- Use a recent Stash release. Stash+ uses the plugin UI API (`PluginApi`) and Stash's O history. Timing-based features and the O Ratings tab need scenes that have O history.
- **Time zone:** all time-of-day and date logic (night owl, weekday, holiday achievements, heatmaps) currently uses the `Europe/Rome` time zone. To change it, search for `Europe/Rome` in `stashPlus.js` and replace it with your own [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
- Tag achievements look up tags by name (for example `creampie`, `anal`, `outdoor`) with a partial match. Achievements for tags you do not have simply stay at zero.
- Height and weight achievements are relative to your own library (median, top and bottom 10%, record holders), not fixed values.
- Unlocked achievements and collapsed sections are remembered in your browser's local storage, so they are per browser.
- On very large libraries the first load of the Achievements and Stats tabs can take a few seconds, because they scan scenes and performers.

## Files

```
stashPlus/stashPlus.yml        plugin manifest
stashPlus/stashPlus.js         UI logic
stashPlus/stashPlus.css        styles
stashOratings/stashOratings.yml
stashOratings/stashOratings.js
```
