# Survivor pool creation + start week

- Added prominent **+ Create pool** action to Survivor context controls.
- User-created Survivor pool instances can choose SEC, Big Ten, or KellyInVegas rule templates.
- Custom pool fields: name, contest format, start week.
- Each custom pool has independent entries, picks, recommendation history, and UI state.
- Start week is functional: weeks before it are excluded from focus-week selection, entry status, used-team accounting, history, pick grids, and optimization paths.
- Added **Pool settings** for custom pools so name/start week can be edited later.
- Existing built-in SEC / Big Ten / Kelly pools remain available for backward compatibility.
- Survivor JS regression suite passed; targeted CFBD Survivor Python reliability checks passed 8/8.
