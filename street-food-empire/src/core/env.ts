/**
 * Környezet-érzékelés.
 *
 * A `__DEV__` a React Native / Metro által beszúrt globális változó. NEM
 * létezik sima Node alatt (balance-szimuláció, build-szkriptek), ezért soha
 * nem hivatkozunk rá közvetlenül – csak ezen a modulon keresztül.
 */

export const IS_DEV: boolean =
  typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

export const IS_TEST: boolean = process.env.NODE_ENV === 'test';
