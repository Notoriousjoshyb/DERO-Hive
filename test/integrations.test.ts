import { describe, expect, test } from 'vitest';
import {
  desktopEnvironment,
  sidecarBinaryCandidates,
  validGatewayEndpoint
} from '../src/main/integrations/registry';

const roots = {
  resources: 'C:\\Program Files\\DERO Hive\\resources',
  appPath: 'C:\\src\\hive',
  userData: 'C:\\Users\\alice\\AppData\\Roaming\\DERO Hive',
  home: 'C:\\Users\\alice'
};

describe('optional integration discovery', () => {
  test('uses fixed Windows binary names and honors an administrator override first', () => {
    const candidates = sidecarBinaryCandidates('hologram', 'win32', roots, {
      DERO_HIVE_HOLOGRAM_PATH: 'D:\\Sidecars\\Hologram.exe'
    });

    expect(candidates[0]).toBe('D:\\Sidecars\\Hologram.exe');
    expect(candidates).toContain('C:\\Program Files\\DERO Hive\\resources\\integrations\\hologram\\bin\\Hologram.exe');
  });

  test('finds the standard PureWolf native-host location', () => {
    expect(sidecarBinaryCandidates('purewolf', 'win32', roots, {})).toContain(
      'C:\\Users\\alice\\.purewolf\\purewolf-native.exe'
    );
  });

  test('accepts only credential-free HTTP gateway endpoints', () => {
    expect(validGatewayEndpoint('http://127.0.0.1:8642/')).toBe('http://127.0.0.1:8642');
    expect(validGatewayEndpoint('http://user:secret@127.0.0.1:8642/')).toBeNull();
    expect(validGatewayEndpoint('file:///tmp/hermes')).toBeNull();
    expect(validGatewayEndpoint('not a url')).toBeNull();
  });

  test('does not expose Hive secrets to a managed desktop process', () => {
    expect(desktopEnvironment('win32', {
      Path: 'C:\\Windows\\System32',
      USERPROFILE: 'C:\\Users\\alice',
      OPENAI_API_KEY: 'secret',
      DERO_HIVE_HOLOGRAM_PATH: 'D:\\Sidecars\\Hologram.exe'
    })).toEqual({
      USERPROFILE: 'C:\\Users\\alice',
      Path: 'C:\\Windows\\System32'
    });
  });
});
