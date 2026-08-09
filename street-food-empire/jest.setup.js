/* eslint-disable no-undef */
// A játéklogika-tesztek nem érintik a natív modulokat, de az AsyncStorage-t
// a mentési rendszer tesztjei használják, ezért memóriában mockoljuk.
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k) => (k in store ? store[k] : null)),
      setItem: jest.fn(async (k, v) => {
        store[k] = String(v);
      }),
      removeItem: jest.fn(async (k) => {
        delete store[k];
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
    },
  };
});
