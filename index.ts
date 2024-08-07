import { inspect } from "bun";
import hass from "homeassistant-ws";
import OpenAI from "openai";
import { z, type AnyZodObject } from "zod";
import { createTools, t } from "zod-to-openai-tool";

const openai = new OpenAI();
const model = "gpt-4o";

// This should be a list of entities that you want to be able to control. Only supports lights, sensors and switches right now.
// Change this to match the entities you have in your Home Assistant setup.
const whitelistedEntities = [
  "light.taklampa_alve_lampa",
  "light.hue_filament_bulb_1",
  "switch.innr_sp_220_brytare",
  "light.bordslampa_brytare",
  "light.hornlampa_brytare",
  "light.silicon_labs_ezsp_alves_lampor",
  "sensor.boiler_v2_pelletss_ckar",
  "sensor.vattentemperatur_2",
  "sensor.luftfuktighet",
  "sensor.temperatur",
  "switch.alves_dator",
  "light.hue_smart_plug_1",
  "light.sunricher_hk_sl_rdim_a_lampa",
  "switch.ender_3_s1_pro_plug_brytare_2",
];

type EntityState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
};

const { tools, processChatActions } = createTools({
  setLight: t
    .input(
      z.object({
        entity_id: z.string().describe("Example: `light.living_room`"),
        kelvin: z.number().optional().describe("Color temperature in Kelvin. Can always be omitted to keep the previous temperature"),
        brightness_pct: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(
            "Brightness level from 0 to 100. Set to 0 to turn off, 100 is full brightness. Set a brightness of more than 0 to turn it on. This can always be set regardless of supported color modes"
          ),
        rgb_color: z.array(z.number()).length(3).optional().describe("RGB color to set the light to"),
        transition: z.number().optional().describe("Transition time in seconds"),
      })
    )
    .describe("Only works with entities starting with light.*")
    .run(async data => {
      await client.callService("light", "turn_on", data);
      return "Light updated";
    }),
  toggleSwitch: t
    .input(
      z.object({
        entity_id: z.string().describe("Example: `switch.living_room`"),
      })
    )
    .describe("Changes the state of a switch from 'on' to 'off' or vice versa")
    .run(async data => {
      await client.callService("switch", "toggle", data);
      return "Switch toggled";
    }),
});

const schemas: Record<string, AnyZodObject> = {
  light: z
    .object({
      min_color_temp_kelvin: z.number(),
      max_color_temp_kelvin: z.number(),
      supported_color_modes: z.array(z.string()),
      color_mode: z.string().nullable(),
      color_temp_kelvin: z.number().nullable(),
      brightness: z.number().nullable(),
      rgb_color: z.array(z.number()).nullable(),
      off_brightness: z.number().nullable(),
    })
    .partial(),
  sensor: z
    .object({
      unit_of_measurement: z.string(),
      device_class: z.string(),
    })
    .partial(),
};

function getStateSummary(states: EntityState[]) {
  const summary = states
    .map(state => {
      const friendlyName = state.attributes.friendly_name;
      const type = state.entity_id.split(".")[0];
      if (!type) {
        throw new Error(`Could not determine type for entity ${state.entity_id}`);
      }

      let specificData = "";
      if (type in schemas) {
        const schema = schemas[type];

        // We know that the schema exists because we checked for it above
        const data = schema!.parse(state.attributes);
        specificData = inspect(data, { depth: Infinity });
      }
      return `"${friendlyName}" (${state.entity_id}): ${state.state} ${specificData}`;
    })
    .join("\n");

  return `The current home state is: \n${summary}`;
}

const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: `You are a home automation assistant.
Before each message, you'll get a summary of the current relevant home state.
If the user tries to do something unsupported, you should refuse to do it.`,
  },
];

const client = await hass({
  token: import.meta.env.HASS_TOKEN,
  host: import.meta.env.HASS_HOST,
  port: +(import.meta.env.HASS_PORT ?? 8123),
  protocol: (import.meta.env.HASS_PROTOCOL as 'ws' | 'wss') ?? 'ws',
});

async function getStates() {
  const states: EntityState[] = await client.getStates();
  return states.filter(state => whitelistedEntities.includes(state.entity_id));
}

for await (const line of console) {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      ...messages,
      { role: "system", content: getStateSummary(await getStates()) },
      {
        role: "user",
        content: line,
      },
    ],
    tools,
  });

  const {message} = completion.choices[0] ?? {};
  if (!message) {
    console.error("No message returned from OpenAI");
    continue;
  }
  messages.push(message);

  if (message.tool_calls) {
    const outputs = await processChatActions(message.tool_calls);
    messages.push(...outputs);
    const completion2 = await openai.chat.completions.create({
      model,
      messages,
      tools,
    });
    const newMessage = completion2.choices[0];
    if (newMessage) {
      messages.push(newMessage.message);
    }
  }

  console.log(messages.at(-1)?.content);
}
