import { createSimulationWorkerHandler, type SimulationWorkerRequest } from "./simulationWorkerProtocol";

const handleRequest = createSimulationWorkerHandler((message) => self.postMessage(message));
self.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => handleRequest(event.data);
