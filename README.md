# Open Autopilot Framework for Spacecraft

[![Project Banner](https://github.com/JMMonte/spacecraft-autopilot/raw/main/src/images/Screenshot%202024-04-12%20at%2012.19.09.png)](https://github.com/JMMonte/spacecraft-autopilot/blob/main/src/images/Screenshot%202024-04-12%20at%2012.19.09.png) [![Project Banner](https://github.com/JMMonte/spacecraft-autopilot/raw/main/src/images/Screenshot%202024-04-12%20at%2012.19.15.png)](https://github.com/JMMonte/spacecraft-autopilot/blob/main/src/images/Screenshot%202024-04-12%20at%2012.19.15.png)

## Project Goals

This project aims to build a series of customizable applications for various use cases of spacecraft autopilot, including:

- LEO maneuvering
- General orbital mechanics
- Approach and docking
- Reentry and landing
- Interplanetary travel
- Non-Keplerian trajectories

In addition to its functional goals, the project emphasizes:

- **Aesthetic appeal:** Keeping the visuals and graphics attractive.
- **Performance:** Ensuring real-time operation unless strictly necessary.

## Features

### Completed

- Fast and real-time procedural physics simulation
- Basic graphics for visual appeal
- Basic autopilot commands:
    - Cancel rotation
    - Cancel rotation and maintain orientation
    - Cancel rotation and point to position
    - Cancel relative linear motion
    - Go to relative 3D coordinate

### In Progress

- Control from docking port reference frame
- Procedural linear motion damping
- Manual multipoint trajectory maneuver (follow path)
- Automated multipoint trajectory maneuver (procedural follow path to reach target around obstacles)

## Version

Current version: **0.0.1**

## Description

This project aims to create a realistic space simulation experience using `Three.js` for rendering and `CANNON.js` for physics. It's an ideal starting point for anyone interested in developing space-related simulations or games.

## Prerequisites

Before you begin, ensure you have Node.js and npm installed on your system. This project relies on them for dependency management and script execution.

- Node.js
- npm (Normally comes with Node.js)

## Installation

To get started with the project, follow these steps:

1. **Clone the Repository**

    ```shell
    git clone https://your-repository-url-here.git
    cd @space/simulator
    ```

2. **Install Dependencies**

    ```shell
    npm install
    ```

3. **Unzip the Required Image File**

    Before starting the simulation, unzip `src/images/spacePanorama-caspianSea.exr.zip`. This file is necessary for the correct rendering of the space panorama in the simulation.

    ```shell
    unzip src/images/spacePanorama-caspianSea.exr.zip -d src/images/
    ```

    Ensure that you have a zip utility installed on your system to execute the unzip command.

## Usage

The project includes scripts for development and production environments:

- **Development**: Run `npm start` to start the development server. Your default web browser will open the project automatically.
- **Production**: Run `npm run build` to create a production build. The output will be located in the `dist` directory.

## To-Do

- [x] Fast and realtime procedural physics simulation
- [x] Basic graphics for eye candy
- [ ] Basic autopilot commands for blueprint
    - [x] Cancel rotation
    - [x] Cancel rotation and maintain orientation
    - [x] Cancel rotation and point to position
    - [x] Cancel relative linear motion
    - [x] Go to relative 3D coordinate
    - [ ] Control from docking port reference frame
    - [ ] Procedural linear motion damping
    - [ ] Manual multipoint trajectory maneuver (follow path)
    - [ ] Automated multipoint trajectory maneuver (procedural follow path to reach target around obstacle)

## Contributing

Contributions are welcome. If you have any improvements or encounter any issues, feel free to create a pull request or open an issue.

## Author

Joao Montenegro

## License

This project is licensed under the ISC License. See the LICENSE file for more details.
