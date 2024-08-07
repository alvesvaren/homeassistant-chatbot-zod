# homeassistant-chatbot-zod

An example chatbot using [zod-to-openai-tool](https://github.com/alvesvaren/zod-to-openai-tool) and [homeassistant-ws](https://github.com/filp/homeassistant-ws). Allows you to control lights, switches and sensors in home assistant from a console chatbot.

To install dependencies:

```bash
bun install
```

To run:

- Copy the `.env.example` file to `.env` and fill in the required fields.
- Update `index.ts` with the correct entity names for your home assistant setup.
- Run the chatbot:
```bash
bun run index.ts
```
