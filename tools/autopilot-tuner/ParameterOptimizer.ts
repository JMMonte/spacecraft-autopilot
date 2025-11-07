/**
 * Parameter Optimizer for Autopilot Fine-Tuning
 * Uses grid search and gradient-free optimization to find optimal parameters
 */

import type { TestScenario, AutopilotParameters, SafetyMetrics } from './CollisionTester';
import { CollisionTester } from './CollisionTester';

export interface OptimizationConfig {
  scenarios: TestScenario[];
  parameterRanges: {
    [K in keyof AutopilotParameters]: {
      min: number;
      max: number;
      steps?: number; // for grid search
    };
  };
  method: 'grid' | 'random' | 'adaptive';
  maxIterations: number;
  parallelTests?: number;
  verbose?: boolean;
}

export interface OptimizationResult {
  bestParameters: AutopilotParameters;
  bestScore: number;
  allResults: Array<{
    parameters: AutopilotParameters;
    score: number;
    scenarioResults: Array<{
      scenario: string;
      metrics: SafetyMetrics;
      score: number;
    }>;
  }>;
  totalTests: number;
  timeElapsed: number;
}

export class ParameterOptimizer {
  private tester: CollisionTester;

  constructor() {
    this.tester = new CollisionTester();
  }

  async initialize(): Promise<void> {
    await this.tester.initialize();
  }

  /**
   * Run optimization to find best autopilot parameters
   */
  async optimize(config: OptimizationConfig): Promise<OptimizationResult> {
    const startTime = Date.now();

    let parameterSets: AutopilotParameters[];

    switch (config.method) {
      case 'grid':
        parameterSets = this.generateGridSearch(config.parameterRanges);
        break;
      case 'random':
        parameterSets = this.generateRandomSearch(config.parameterRanges, config.maxIterations);
        break;
      case 'adaptive':
        return await this.runAdaptiveSearch(config);
      default:
        throw new Error(`Unknown optimization method: ${config.method}`);
    }

    // Limit to max iterations
    parameterSets = parameterSets.slice(0, config.maxIterations);

    if (config.verbose) {
      console.log(`Testing ${parameterSets.length} parameter combinations...`);
    }

    // Test all parameter sets
    const allResults: OptimizationResult['allResults'] = [];
    let bestScore = -Infinity;
    let bestParameters: AutopilotParameters = parameterSets[0];

    for (let i = 0; i < parameterSets.length; i++) {
      const params = parameterSets[i];

      if (config.verbose && i % 10 === 0) {
        console.log(`Progress: ${i}/${parameterSets.length} (${((i / parameterSets.length) * 100).toFixed(1)}%)`);
        console.log(`Current best score: ${bestScore.toFixed(2)}`);
      }

      // Test on all scenarios
      const scenarioResults: OptimizationResult['allResults'][0]['scenarioResults'] = [];
      let totalScore = 0;

      for (const scenario of config.scenarios) {
        try {
          const metrics = await this.tester.runScenario(scenario, params);
          const score = CollisionTester.calculateSafetyScore(metrics, scenario);

          scenarioResults.push({
            scenario: scenario.name,
            metrics,
            score
          });

          totalScore += score;
        } catch (error) {
          if (config.verbose) {
            console.error(`Error testing scenario ${scenario.name}:`, error);
          }
          // Penalize failed tests
          scenarioResults.push({
            scenario: scenario.name,
            metrics: this.getFailedMetrics(),
            score: 0
          });
        }
      }

      // Average score across all scenarios
      const avgScore = totalScore / config.scenarios.length;

      allResults.push({
        parameters: params,
        score: avgScore,
        scenarioResults
      });

      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestParameters = { ...params };

        if (config.verbose) {
          console.log(`\n🎯 New best score: ${bestScore.toFixed(2)}`);
          console.log('Parameters:', params);
        }
      }
    }

    const timeElapsed = Date.now() - startTime;

    // Sort results by score
    allResults.sort((a, b) => b.score - a.score);

    return {
      bestParameters,
      bestScore,
      allResults,
      totalTests: parameterSets.length,
      timeElapsed
    };
  }

  /**
   * Generate parameter sets for grid search
   */
  private generateGridSearch(
    ranges: OptimizationConfig['parameterRanges']
  ): AutopilotParameters[] {
    const keys = Object.keys(ranges) as Array<keyof AutopilotParameters>;
    const values: number[][] = [];

    for (const key of keys) {
      const range = ranges[key];
      const steps = range.steps || 3;
      const stepSize = (range.max - range.min) / (steps - 1);

      const vals: number[] = [];
      for (let i = 0; i < steps; i++) {
        vals.push(range.min + i * stepSize);
      }
      values.push(vals);
    }

    // Generate all combinations
    const combinations = this.cartesianProduct(values);

    return combinations.map(combo => {
      const params: any = {};
      keys.forEach((key, i) => {
        params[key] = combo[i];
      });
      return params as AutopilotParameters;
    });
  }

  /**
   * Generate parameter sets for random search
   */
  private generateRandomSearch(
    ranges: OptimizationConfig['parameterRanges'],
    count: number
  ): AutopilotParameters[] {
    const results: AutopilotParameters[] = [];
    const keys = Object.keys(ranges) as Array<keyof AutopilotParameters>;

    for (let i = 0; i < count; i++) {
      const params: any = {};

      for (const key of keys) {
        const range = ranges[key];
        params[key] = range.min + Math.random() * (range.max - range.min);
      }

      results.push(params as AutopilotParameters);
    }

    return results;
  }

  /**
   * Adaptive search using coordinate descent
   */
  private async runAdaptiveSearch(config: OptimizationConfig): Promise<OptimizationResult> {
    const startTime = Date.now();
    const allResults: OptimizationResult['allResults'] = [];

    // Start with middle values
    const current: AutopilotParameters = {} as AutopilotParameters;
    const keys = Object.keys(config.parameterRanges) as Array<keyof AutopilotParameters>;

    for (const key of keys) {
      const range = config.parameterRanges[key];
      current[key] = (range.min + range.max) / 2;
    }

    let currentScore = await this.evaluateParameters(current, config.scenarios, allResults);
    let bestParameters = { ...current };
    let bestScore = currentScore;

    if (config.verbose) {
      console.log(`Initial score: ${currentScore.toFixed(2)}`);
    }

    // Adaptive search iterations
    let iteration = 0;
    let stepSize = 0.5; // Start with large steps
    const minStepSize = 0.05;
    let noImprovementCount = 0;

    while (iteration < config.maxIterations && stepSize >= minStepSize) {
      if (config.verbose) {
        console.log(`\nIteration ${iteration + 1}, Step size: ${stepSize.toFixed(3)}`);
      }

      let improved = false;

      // Try adjusting each parameter
      for (const key of keys) {
        const range = config.parameterRanges[key];
        const paramRange = range.max - range.min;
        const delta = paramRange * stepSize;

        // Try increasing
        const testUp = { ...current };
        testUp[key] = Math.min(range.max, current[key] + delta);
        const scoreUp = await this.evaluateParameters(testUp, config.scenarios, allResults);

        // Try decreasing
        const testDown = { ...current };
        testDown[key] = Math.max(range.min, current[key] - delta);
        const scoreDown = await this.evaluateParameters(testDown, config.scenarios, allResults);

        // Pick best direction
        if (scoreUp > currentScore || scoreDown > currentScore) {
          if (scoreUp > scoreDown) {
            current[key] = testUp[key];
            currentScore = scoreUp;
          } else {
            current[key] = testDown[key];
            currentScore = scoreDown;
          }
          improved = true;

          if (currentScore > bestScore) {
            bestScore = currentScore;
            bestParameters = { ...current };

            if (config.verbose) {
              console.log(`  ✓ ${key}: ${current[key].toFixed(4)} (score: ${currentScore.toFixed(2)})`);
            }
          }
        }
      }

      if (improved) {
        noImprovementCount = 0;
      } else {
        noImprovementCount++;
        if (noImprovementCount >= 2) {
          // Reduce step size
          stepSize *= 0.5;
          noImprovementCount = 0;

          if (config.verbose) {
            console.log(`  No improvement, reducing step size to ${stepSize.toFixed(3)}`);
          }
        }
      }

      iteration++;
    }

    const timeElapsed = Date.now() - startTime;

    allResults.sort((a, b) => b.score - a.score);

    return {
      bestParameters,
      bestScore,
      allResults,
      totalTests: allResults.length,
      timeElapsed
    };
  }

  /**
   * Evaluate a parameter set on all scenarios
   */
  private async evaluateParameters(
    params: AutopilotParameters,
    scenarios: TestScenario[],
    allResults: OptimizationResult['allResults']
  ): Promise<number> {
    const scenarioResults: OptimizationResult['allResults'][0]['scenarioResults'] = [];
    let totalScore = 0;

    for (const scenario of scenarios) {
      try {
        const metrics = await this.tester.runScenario(scenario, params);
        const score = CollisionTester.calculateSafetyScore(metrics, scenario);

        scenarioResults.push({
          scenario: scenario.name,
          metrics,
          score
        });

        totalScore += score;
      } catch (error) {
        scenarioResults.push({
          scenario: scenario.name,
          metrics: this.getFailedMetrics(),
          score: 0
        });
      }
    }

    const avgScore = totalScore / scenarios.length;

    allResults.push({
      parameters: params,
      score: avgScore,
      scenarioResults
    });

    return avgScore;
  }

  /**
   * Cartesian product of arrays
   */
  private cartesianProduct<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]];
    if (arrays.length === 1) return arrays[0].map(x => [x]);

    const [first, ...rest] = arrays;
    const restProduct = this.cartesianProduct(rest);

    const result: T[][] = [];
    for (const item of first) {
      for (const combo of restProduct) {
        result.push([item, ...combo]);
      }
    }

    return result;
  }

  /**
   * Get default failed metrics
   */
  private getFailedMetrics(): SafetyMetrics {
    return {
      collisions: [],
      minDistanceToObstacles: 0,
      timeToTarget: Infinity,
      success: false,
      finalDistance: Infinity,
      pathEfficiency: 0,
      averageSpeed: 0,
      maxSpeed: 0,
      fuelUsed: Infinity
    };
  }

  /**
   * Export optimization results to JSON
   */
  static exportResults(result: OptimizationResult, includeAllTests: boolean = false): string {
    const summary = {
      bestParameters: result.bestParameters,
      bestScore: result.bestScore,
      totalTests: result.totalTests,
      timeElapsed: result.timeElapsed,
      timeElapsedFormatted: this.formatTime(result.timeElapsed),
      topResults: result.allResults.slice(0, 10).map(r => ({
        score: r.score,
        parameters: r.parameters,
        scenarios: r.scenarioResults.map(s => ({
          name: s.scenario,
          score: s.score,
          success: s.metrics.success,
          collisions: s.metrics.collisions.length,
          minDistance: s.metrics.minDistanceToObstacles
        }))
      }))
    };

    if (includeAllTests) {
      return JSON.stringify({ ...summary, allResults: result.allResults }, null, 2);
    }

    return JSON.stringify(summary, null, 2);
  }

  /**
   * Format time in human readable form
   */
  private static formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}


