// Stand-in for @coinbase/cdp-sdk (see next.config.ts). @base-org/account imports CdpClient only for server-side
// subscription charges, which a browser wallet connection never reaches.
export class CdpClient {
  constructor() {
    throw new Error('@coinbase/cdp-sdk is not bundled in Monday');
  }
}
