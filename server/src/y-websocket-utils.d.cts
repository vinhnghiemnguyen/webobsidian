import { WebSocket } from 'ws';
import * as http from 'http';
export function setupWSConnection(conn: WebSocket, req: http.IncomingMessage, options?: any): void;
