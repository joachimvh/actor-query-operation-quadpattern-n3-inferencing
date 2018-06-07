import {
  ActorQueryOperation, ActorQueryOperationTypedMediated, Bindings,
  IActorQueryOperationTypedMediatedArgs
} from "@comunica/bus-query-operation";
import {IActorTest, Mediator} from "@comunica/core";
import {RoundRobinUnionIterator} from "asynciterator-union";
import * as DataFactory from "rdf-data-model";
import * as RdfString from "rdf-string";
import {Algebra, Factory} from "sparqlalgebrajs";
import {getTerms, getVariables, QUAD_TERM_NAMES} from "rdf-terms";
import {
  IActionQueryOperation, IActorQueryOperationOutput,
  IActorQueryOperationOutputBindings
} from "@comunica/bus-query-operation/lib/ActorQueryOperation";
import {PromiseProxyIterator} from "asynciterator-promiseproxy";
import {BindingsStream} from "@comunica/bus-query-operation/lib/Bindings";

const Reasoner = require('jsreasoner');
const BackwardReasoner = Reasoner.BackwardReasoner;
const Parser = Reasoner.N3Parser;
const Terms = Reasoner.Terms;

/**
 * A comunica Quadpattern N3 Inferencing Query Operation Actor.
 */
export class ActorQueryOperationQuadpatternN3Inferencing extends ActorQueryOperationTypedMediated<Algebra.Pattern>
  implements IActorQueryOperationQuadpatternN3InferencingArgs{

  private factory: Factory;
  private readonly n3Rules: any[];

  readonly rules: string;
  readonly mediatorPattern: Mediator<ActorQueryOperation, IActionQueryOperation, IActorTest, IActorQueryOperationOutput>;


  constructor(args: IActorQueryOperationQuadpatternN3InferencingArgs) {
    super(args, 'pattern');
    this.factory = new Factory();

    // TODO: dynamic rules source? combine with fixed rules?
    if (args.rules) {
      this.n3Rules = [].concat(...Parser.toTerms(args.rules).map((x: any) => x.toSNF()));
    } else {
      this.n3Rules = [];
    }
  }

  private toRdfjs(term: any): any {
    if (term instanceof Terms.Variable)
      return DataFactory.variable(term.name);
    else if (term instanceof Terms.Constant)
      return term.value;
    else
      return this.factory.createPattern(this.toRdfjs(term.subject), this.toRdfjs(term.predicate), this.toRdfjs(term.object), this.toRdfjs(term.graph));
  }

  private fromRdfjs(term: any): any
  {
    if (term.termType === 'Variable')
      return new Terms.Variable(term.value);
    else if (term.termType === 'Literal' || term.termType === 'NamedNode' || term.termType === 'DefaultGraph')
      return new Terms.Constant(term);
    else
      return new Terms.Pattern(this.fromRdfjs(term.subject), this.fromRdfjs(term.predicate), this.fromRdfjs(term.object), this.fromRdfjs(term.graph));
  }

  public async testOperation(pattern: Algebra.Pattern, context?: {[id: string]: any}): Promise<IActorTest> {
    return true;
  }

  // TODO: blank nodes
  // TODO: how to prevent duplicate triples (e.g. { ?x :p ?z } => { ?z :p ?x } will keep triggering)
  // TODO: how to re-use results on 2 separate calls
  public async runOperation(pattern: Algebra.Pattern, context?: {[id: string]: any})
    : Promise<IActorQueryOperationOutputBindings> {

    const patternStrings: {[id:string]: string} = {};
    for (let pos of QUAD_TERM_NAMES) {
      patternStrings[pos] = RdfString.termToString(pattern[pos]);
    }
    const n3Pattern = this.fromRdfjs(pattern);

    const results: BindingsStream[] = [];

    const patternOutput = ActorQueryOperation.getSafeBindings(
      await this.mediatorPattern.mediate({operation: pattern, context}));
    results.push(patternOutput.bindingsStream);

    // TODO: also find indirect rules (e.g., rules generating rules that can find a result)
    for (let {map, rule, match} of BackwardReasoner.matchingRules(n3Pattern, this.n3Rules)) {
      const conclusion = this.toRdfjs(match.applyMapping(map));
      const conclusionStrings: { [id: string]: string } = {};
      for (let pos of QUAD_TERM_NAMES) {
        conclusionStrings[pos] = RdfString.termToString(conclusion[pos]);
      }
      // TODO: assuming everything in premise is a default pattern (i.e., no builtins, formulas, lists, etc.)
      const premise: Algebra.Pattern[] = BackwardReasoner.createGoals(rule, map).map((x: any) => this.toRdfjs(x));

      // this would provide invalid results by not being supported in normal RDF
      if (premise.some(term => term.subject.termType === 'Literal' || term.predicate.termType === 'Literal')) {
        continue;
      }

      const proxyStream = new PromiseProxyIterator(async () => {
        const premiseOutput = ActorQueryOperation.getSafeBindings(await this.mediatorQueryOperation.mediate({
          operation: this.factory.createBgp(premise),
          context: context
        }));

        const premiseResults = premiseOutput.bindingsStream.transform<Bindings>({
          transform: (bindings, done) => {
            let bindingsResult: { [id: string]: any } = {};

            for (let pos of QUAD_TERM_NAMES) {
              if (pattern[pos].termType === 'Variable') {
                if (conclusion[pos].termType === 'Variable') {
                  // make sure the same variable name as the original pattern gets used
                  bindingsResult[patternStrings[pos]] = bindings.get(conclusionStrings[pos]);
                } else {
                  bindingsResult[patternStrings[pos]] = conclusion[pos];
                }
              }
            }
            premiseResults._push(Bindings(bindingsResult));
            done(null);
          }
        });

        return premiseResults;
      });

      results.push(proxyStream);
    }

    /* the metadata of the inferred streams could also be used to calculate totalItems,
     * but the problem there is that those might be infinite so never actually return a result for metadata */

    return {
      type:           'bindings',
      bindingsStream: results.length === 1 ? results[0] : new RoundRobinUnionIterator<Bindings>(results),
      metadata:       patternOutput.metadata,
      variables:      getVariables(getTerms(pattern)).map(RdfString.termToString)
    };
  }
}

export interface IActorQueryOperationQuadpatternN3InferencingArgs extends IActorQueryOperationTypedMediatedArgs {
  mediatorPattern: Mediator<ActorQueryOperation, IActionQueryOperation, IActorTest, IActorQueryOperationOutput>;
  rules: string;
}
