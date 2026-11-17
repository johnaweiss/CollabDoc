# CollabDoc

CollabDoc lets you edit a local HTML file in your browser and save it back to your computer. Install it as an app from https://johnaweiss.github.io/CollabDoc/, open a file, edit the text on the page, and save.

## CollabDoc CLI

The CollabDoc CLI lets AI agents edit the rendered content of a web page without opening the page in a browser. The agent reads the file, finds the text it wants to change, and replaces it in place; the rest of the file is left untouched. If the person editing in the app has saved in the meantime, the agent's edit is refused and the agent is shown the change, so it can rethink and retry.

While an agent works, a small helper (the relay) runs on your computer and passes messages between the CLI and the open app, so each side learns at once when the other saves. The agent stops it with `collabdoc stop-session`.

Download the CLI from the app with the **Download CollabDoc CLI** link. Windows only for now.
