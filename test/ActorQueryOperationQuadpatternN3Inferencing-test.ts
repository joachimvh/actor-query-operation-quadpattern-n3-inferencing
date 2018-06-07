import {ActorQueryOperation, Bindings} from "@comunica/bus-query-operation";
import {Bus} from "@comunica/core";
import {ArrayIterator} from "asynciterator";
import {defaultGraph, literal, namedNode, variable} from "rdf-data-model";
import {ActorQueryOperationQuadpatternN3Inferencing} from "../lib/ActorQueryOperationQuadpatternN3Inferencing";
const arrayifyStream = require('arrayify-stream');

describe('ActorQueryOperationQuadpatternN3Inferencing', () => {
  let bus;
  let mediatorQueryOperation;

  beforeEach(() => {
    bus = new Bus({ name: 'bus' });
    mediatorQueryOperation = {
      mediate: (arg) => Promise.resolve({
        bindingsStream: new ArrayIterator([
          Bindings({ '?v_0': literal('1') }),
          Bindings({ '?v_0': literal('2') }),
          Bindings({ '?v_0': literal('3') }),
        ]),
        metadata: () => Promise.resolve({ totalItems: 3 }),
        operated: arg,
        type: 'bindings',
        variables: ['a'],
      }),
    };
  });

  describe('The ActorQueryOperationQuadpatternN3Inferencing module', () => {
    it('should be a function', () => {
      expect(ActorQueryOperationQuadpatternN3Inferencing).toBeInstanceOf(Function);
    });

    it('should be a ActorQueryOperationQuadpatternN3Inferencing constructor', () => {
      expect(new (<any> ActorQueryOperationQuadpatternN3Inferencing)({ name: 'actor', bus, mediatorQueryOperation }))
        .toBeInstanceOf(ActorQueryOperationQuadpatternN3Inferencing);
      expect(new (<any> ActorQueryOperationQuadpatternN3Inferencing)({ name: 'actor', bus, mediatorQueryOperation }))
        .toBeInstanceOf(ActorQueryOperation);
    });

    it('should not be able to create new ActorQueryOperationQuadpatternN3Inferencing objects without \'new\'', () => {
      expect(() => { (<any> ActorQueryOperationQuadpatternN3Inferencing)(); }).toThrow();
    });
  });

  describe('An ActorQueryOperationQuadpatternN3Inferencing instance', () => {
    let actor: ActorQueryOperationQuadpatternN3Inferencing;
    let mediatorPattern;
    let rules;

    beforeEach(() => {
      mediatorPattern = {
        mediate: (arg) => Promise.resolve({
          bindingsStream: new ArrayIterator([
            Bindings({ '?z': literal('a') }),
            Bindings({ '?z': literal('b') })
          ]),
          metadata: () => Promise.resolve({ totalItems: 2 }),
          operated: arg,
          type: 'bindings',
          variables: ['a'],
        }),
      };
      rules = '{ ?x :a :b } => { ?x :c :d }.';
      actor = new ActorQueryOperationQuadpatternN3Inferencing({ name: 'actor', bus, mediatorQueryOperation, mediatorPattern, rules });
    });

    it('should test on pattern', () => {
      const op = { operation: { type: 'pattern' } };
      return expect(actor.test(op)).resolves.toBeTruthy();
    });

    it('should not test on non-pattern', () => {
      const op = { operation: { type: 'some-other-type' } };
      return expect(actor.test(op)).rejects.toBeTruthy();
    });

    it('should return pattern results', async () => {
      const op = { operation: {
          graph: defaultGraph(),
          object: namedNode('o'),
          predicate: variable('p'),
          subject: namedNode('s'),
          type: 'pattern',
        } };
      let output = ActorQueryOperation.getSafeBindings(await actor.run(op));
      expect(await output.metadata()).toMatchObject({ totalItems: 2 });
      expect(await arrayifyStream(output.bindingsStream)).toEqual([
        Bindings({ '?z': literal('a') }),
        Bindings({ '?z': literal('b') })
      ]);
    });

    it('should return applicable rule results', async () => {
      const op = { operation: {
          graph: defaultGraph(),
          object: namedNode(':d'),
          predicate: namedNode(':c'),
          subject: variable('z'),
          type: 'pattern',
        } };
      let output = ActorQueryOperation.getSafeBindings(await actor.run(op));
      // only counts totalItems of original results
      expect(await output.metadata()).toMatchObject({ totalItems: 2 });
      expect(await arrayifyStream(output.bindingsStream)).toEqual([
        Bindings({ '?z': literal('a') }),
        Bindings({ '?z': literal('b') }),
        Bindings({ '?z': literal('1') }),
        Bindings({ '?z': literal('2') }),
        Bindings({ '?z': literal('3') })
      ]);
    });

    it('handles patterns having more variables than rules', async () => {
      const op = { operation: {
          graph: defaultGraph(),
          object: variable('x'),
          predicate: namedNode(':c'),
          subject: variable('z'),
          type: 'pattern',
        } };
      let output = ActorQueryOperation.getSafeBindings(await actor.run(op));
      // only counts totalItems of original results
      expect(await output.metadata()).toMatchObject({ totalItems: 2 });
      expect(await arrayifyStream(output.bindingsStream)).toEqual([
        Bindings({ '?z': literal('a') }),
        Bindings({ '?z': literal('b') }),
        Bindings({ '?z': literal('1'), '?x': namedNode(':d') }),
        Bindings({ '?z': literal('2'), '?x': namedNode(':d')  }),
        Bindings({ '?z': literal('3'), '?x': namedNode(':d')  })
      ]);
    });
  });
});
