import Settings from "./settings";
import { startIntegration, stopIntegration, useSettings } from "./integration";
export default plugin<{ jsonStorage: Record<string, any> }>({
  jsonStorage: { load: true, default: useSettings.defaults },
  async start({ jsonStorage, cleanup, plugin: instance }) {
    const data = await jsonStorage.get();
    useSettings.attach(data, jsonStorage, (error) =>
      instance.reportError(error),
    );
    cleanup(async () => {
      stopIntegration();
      await useSettings.detach();
    });
    startIntegration((error) => instance.reportError(error));
    if (instance.startedLate) instance.requireReload();
  },
  stop({ plugin: instance }) {
    instance.requireReload();
  },
  SettingsComponent: Settings,
});
