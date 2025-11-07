/**
 * Autopilot Tuner - Main Entry Point
 * Command-line tool for automated autopilot testing and optimization
 */

import { CollisionTester, type AutopilotParameters } from './CollisionTester';
import { ScenarioGenerator } from './ScenarioGenerator';
import { ParameterOptimizer } from './ParameterOptimizer';
import * as fs from 'fs';
import * as path from 'path';

interface CliOptions {
  mode: 'test' | 'optimize' | 'validate';
  scenarios?: string[]; // 'all' or specific scenario names
  method?: 'grid' | 'random' | 'adaptive';
  iterations?: number;
  output?: string;
  verbose?: boolean;
  parameters?: string; // path to JSON file with parameters to test/validate
}

/**
 * Default parameter ranges for optimization
 */
const DEFAULT_PARAMETER_RANGES = {
  positionKp: { min: 0.5, max: 1.5, steps: 4 },
  positionKi: { min: 0.0, max: 0.01, steps: 3 },
  positionKd: { min: 0.2, max: 1.0, steps: 4 },

  velocityKp: { min: 1.0, max: 4.0, steps: 4 },
  velocityKi: { min: 0.0, max: 0.1, steps: 3 },
  velocityKd: { min: 0.3, max: 1.5, steps: 4 },

  maxApproachSpeed: { min: 1.0, max: 3.0, steps: 3 },
  brakingMargin: { min: 1.1, max: 1.5, steps: 3 },

  alignGateOnDeg: { min: 10, max: 20, steps: 3 },
  alignGateOffDeg: { min: 5, max: 12, steps: 3 },

  deviationThreshold: { min: 1.5, max: 4.0, steps: 3 },
  replanInterval: { min: 0.3, max: 0.8, steps: 3 }
};

/**
 * Current default parameters from GoToPosition.ts
 */
const CURRENT_PARAMETERS: AutopilotParameters = {
  positionKp: 0.8,
  positionKi: 0.001,
  positionKd: 0.5,

  velocityKp: 2.0,
  velocityKi: 0.05,
  velocityKd: 0.8,

  maxApproachSpeed: 2.0,
  brakingMargin: 1.2,

  alignGateOnDeg: 15,
  alignGateOffDeg: 8,

  deviationThreshold: 2.5,
  replanInterval: 0.5
};

class AutopilotTunerCLI {
  private tester: CollisionTester;
  private optimizer: ParameterOptimizer;

  constructor() {
    this.tester = new CollisionTester();
    this.optimizer = new ParameterOptimizer();
  }

  async run(options: CliOptions): Promise<void> {
    console.log('🚀 Spacecraft Autopilot Tuner\n');

    // Initialize physics engine
    console.log('Initializing physics engine...');
    await this.tester.initialize();
    await this.optimizer.initialize();
    console.log('✓ Physics engine ready\n');

    // Get scenarios
    const scenarios = this.getScenarios(options.scenarios);
    console.log(`Testing with ${scenarios.length} scenario(s):\n  - ${scenarios.map(s => s.name).join('\n  - ')}\n`);

    switch (options.mode) {
      case 'test':
        await this.runTest(scenarios, options);
        break;
      case 'optimize':
        await this.runOptimization(scenarios, options);
        break;
      case 'validate':
        await this.runValidation(scenarios, options);
        break;
      default:
        throw new Error(`Unknown mode: ${options.mode}`);
    }
  }

  /**
   * Test current or custom parameters
   */
  private async runTest(scenarios: any[], options: CliOptions): Promise<void> {
    const params = options.parameters
      ? JSON.parse(fs.readFileSync(options.parameters, 'utf-8'))
      : CURRENT_PARAMETERS;

    console.log('Testing parameters:');
    console.log(JSON.stringify(params, null, 2));
    console.log();

    const results: any[] = [];

    for (const scenario of scenarios) {
      console.log(`\n📍 Testing scenario: ${scenario.name}`);
      console.log('─'.repeat(50));

      const metrics = await this.tester.runScenario(scenario, params, (state, partialMetrics) => {
        if (options.verbose) {
          process.stdout.write(`\r  Time: ${state.time.toFixed(1)}s | Distance: ${partialMetrics.finalDistance?.toFixed(2) || 'N/A'}m`);
        }
      });

      if (options.verbose) {
        console.log(); // New line after progress
      }

      const score = CollisionTester.calculateSafetyScore(metrics, scenario);

      console.log('\nResults:');
      console.log(`  Success: ${metrics.success ? '✓' : '✗'}`);
      console.log(`  Collisions: ${metrics.collisions.length}`);
      if (metrics.collisions.length > 0) {
        console.log(`    Critical: ${metrics.collisions.filter(c => c.severity === 'critical').length}`);
        console.log(`    Major: ${metrics.collisions.filter(c => c.severity === 'major').length}`);
        console.log(`    Minor: ${metrics.collisions.filter(c => c.severity === 'minor').length}`);
      }
      console.log(`  Min Distance to Obstacles: ${metrics.minDistanceToObstacles.toFixed(2)}m`);
      console.log(`  Time to Target: ${metrics.timeToTarget.toFixed(2)}s`);
      console.log(`  Path Efficiency: ${(metrics.pathEfficiency * 100).toFixed(1)}%`);
      console.log(`  Max Speed: ${metrics.maxSpeed.toFixed(2)}m/s`);
      console.log(`  Safety Score: ${score.toFixed(2)}/100`);

      results.push({
        scenario: scenario.name,
        metrics,
        score
      });
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));

    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    const successRate = (results.filter(r => r.metrics.success).length / results.length) * 100;
    const totalCollisions = results.reduce((sum, r) => sum + r.metrics.collisions.length, 0);

    console.log(`Average Score: ${avgScore.toFixed(2)}/100`);
    console.log(`Success Rate: ${successRate.toFixed(1)}%`);
    console.log(`Total Collisions: ${totalCollisions}`);

    // Save results
    if (options.output) {
      const outputData = {
        parameters: params,
        results,
        summary: {
          avgScore,
          successRate,
          totalCollisions
        }
      };
      this.saveResults(outputData, options.output);
    }
  }

  /**
   * Run parameter optimization
   */
  private async runOptimization(scenarios: any[], options: CliOptions): Promise<void> {
    console.log('Starting optimization...');
    console.log(`Method: ${options.method || 'adaptive'}`);
    console.log(`Max iterations: ${options.iterations || 100}\n`);

    const result = await this.optimizer.optimize({
      scenarios,
      parameterRanges: DEFAULT_PARAMETER_RANGES,
      method: options.method || 'adaptive',
      maxIterations: options.iterations || 100,
      verbose: options.verbose ?? true
    });

    console.log('\n' + '='.repeat(50));
    console.log('OPTIMIZATION COMPLETE');
    console.log('='.repeat(50));
    console.log(`Total tests: ${result.totalTests}`);
    console.log(`Time elapsed: ${this.formatTime(result.timeElapsed)}`);
    console.log(`Best score: ${result.bestScore.toFixed(2)}/100\n`);

    console.log('Best parameters:');
    console.log(JSON.stringify(result.bestParameters, null, 2));

    // Compare with current
    console.log('\n📊 Comparison with current parameters:');
    const currentResult = result.allResults.find(r =>
      this.parametersEqual(r.parameters, CURRENT_PARAMETERS)
    );

    if (currentResult) {
      const improvement = ((result.bestScore - currentResult.score) / currentResult.score * 100);
      console.log(`Current score: ${currentResult.score.toFixed(2)}/100`);
      console.log(`Best score: ${result.bestScore.toFixed(2)}/100`);
      console.log(`Improvement: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);
    }

    // Save results
    if (options.output) {
      const exportData = ParameterOptimizer.exportResults(result, true);
      this.saveResults(exportData, options.output);
    } else {
      // Save to default location
      const defaultPath = path.join(process.cwd(), 'autopilot-optimization-results.json');
      const exportData = ParameterOptimizer.exportResults(result, false);
      this.saveResults(exportData, defaultPath);
    }
  }

  /**
   * Validate parameters against all scenarios
   */
  private async runValidation(scenarios: any[], options: CliOptions): Promise<void> {
    if (!options.parameters) {
      throw new Error('--parameters flag required for validation mode');
    }

    const params = JSON.parse(fs.readFileSync(options.parameters, 'utf-8'));

    console.log('Validating parameters against all scenarios...\n');

    await this.runTest(scenarios, { ...options, mode: 'test' });
  }

  /**
   * Get scenarios based on options
   */
  private getScenarios(scenarioNames?: string[]): any[] {
    const allScenarios = ScenarioGenerator.getAllScenarios();

    if (!scenarioNames || scenarioNames.includes('all')) {
      return allScenarios;
    }

    return allScenarios.filter(s => scenarioNames.includes(s.name));
  }

  /**
   * Save results to file
   */
  private saveResults(data: any, outputPath: string): void {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(outputPath, content);
    console.log(`\n✓ Results saved to: ${outputPath}`);
  }

  /**
   * Check if two parameter sets are equal
   */
  private parametersEqual(a: AutopilotParameters, b: AutopilotParameters): boolean {
    const keys = Object.keys(a) as Array<keyof AutopilotParameters>;
    return keys.every(key => Math.abs(a[key] - b[key]) < 0.001);
  }

  /**
   * Format time duration
   */
  private formatTime(ms: number): string {
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

// Parse command line arguments
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    mode: 'test',
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--mode':
      case '-m':
        options.mode = args[++i] as CliOptions['mode'];
        break;
      case '--scenarios':
      case '-s':
        options.scenarios = args[++i].split(',');
        break;
      case '--method':
        options.method = args[++i] as CliOptions['method'];
        break;
      case '--iterations':
      case '-i':
        options.iterations = parseInt(args[++i]);
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--parameters':
      case '-p':
        options.parameters = args[++i];
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Spacecraft Autopilot Tuner

Usage: npm run tune [options]

Modes:
  test       Test current or custom parameters
  optimize   Find optimal parameters
  validate   Validate parameters against all scenarios

Options:
  -m, --mode <mode>           Mode: test, optimize, validate (default: test)
  -s, --scenarios <names>     Comma-separated scenario names or 'all' (default: all)
  --method <method>           Optimization method: grid, random, adaptive (default: adaptive)
  -i, --iterations <n>        Max iterations for optimization (default: 100)
  -o, --output <path>         Output file path for results
  -p, --parameters <path>     Path to JSON file with parameters to test
  -v, --verbose               Verbose output
  -h, --help                  Show this help

Scenarios:
  - corridor          Navigate through a corridor with walls
  - slalom            Navigate through alternating obstacles
  - asteroidField     Dense field of asteroids
  - docking           Tight space docking maneuver
  - narrowGap         Navigate through a narrow opening
  - emergencyAvoidance Quick avoidance of obstacle in path
  - maze              Complex multi-obstacle navigation

Examples:
  # Test current parameters on all scenarios
  npm run tune

  # Test custom parameters
  npm run tune -- --mode test --parameters ./my-params.json

  # Optimize parameters using adaptive search
  npm run tune -- --mode optimize --method adaptive --iterations 50

  # Quick grid search on specific scenarios
  npm run tune -- --mode optimize --method grid --scenarios corridor,slalom -i 20

  # Validate optimized parameters
  npm run tune -- --mode validate --parameters ./optimized-params.json
`);
}

// Main execution
// Check if this is the main module (ES module compatible)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const options = parseArgs();
  const cli = new AutopilotTunerCLI();

  cli.run(options).catch(error => {
    console.error('\n❌ Error:', error.message);
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  });
}

export { AutopilotTunerCLI, CURRENT_PARAMETERS, DEFAULT_PARAMETER_RANGES };

