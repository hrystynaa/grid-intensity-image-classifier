import { restoreNetwork, runNetwork, trainNetwork } from '../nn/network.js';

const PROGRESS_INTERVAL_MS = 50;

let net = null;
let stopRequested = false;

const reply = (id, payload) => self.postMessage({ id, ...payload });

const handlers = {
  async train({ id, train, validation, config }) {
    stopRequested = false;
    let lastPost = 0;
    const { net: trained, ...summary } = await trainNetwork({
      ...config,
      train,
      validation,
      shouldStop: () => stopRequested,
      onEpoch({ epoch, total, error }) {
        const time = performance.now();
        if (epoch === total || time - lastPost >= PROGRESS_INTERVAL_MS) {
          lastPost = time;
          reply(id, { type: 'epoch', epoch, total, error });
        }
      },
    });
    net = trained;
    reply(id, { type: 'result', ...summary, network: trained.toJSON() });
  },

  load({ id, network }) {
    net = restoreNetwork(network);
    reply(id, { type: 'result' });
  },

  predict({ id, means }) {
    if (!net) throw new Error('Model is not ready');
    reply(id, { type: 'result', outputs: Array.from(runNetwork(net, means)) });
  },

  stop() {
    stopRequested = true;
  },
};

self.onmessage = async ({ data }) => {
  try {
    await handlers[data.type](data);
  } catch (error) {
    reply(data.id, { type: 'error', message: error.message });
  }
};
