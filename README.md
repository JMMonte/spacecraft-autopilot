# Realistic 3d Spacecraft simulator in THREEJS+CANNON

A simple Three.js application that simulates spacecraft physics in 3d in 0g, with autopilot, using Webpack for asset bundling and development server capabilities.

![Screenshot](src/images/Screenshot%202024-04-12%20at%2012.19.09.png)
![Screenshot](src/images/Screenshot%202024-04-12%20at%2012.19.15.png)

## Version

1.0.0

## Description

This project aims to create a realistic space simulation experience using `Three.js` for rendering and `CANNON.js` for physics. It's an ideal starting point for anyone interested in developing space-related simulations or games.

## Prerequisites

Before you begin, ensure you have Node.js and npm installed on your system. This project relies on them for dependency management and script execution.

- Node.js
- npm (Normally comes with Node.js)

## Installation

To get started with the project, follow these steps:

1. **Clone the Repository**

```bash
git clone https://your-repository-url-here.git
cd @space/simulator
```

2. **Install Dependencies**

```bash
npm install
```

3. **Unzip the Required Image File**

Before starting the simulation, unzip `src/images/spacePanorama-caspianSea.exr.zip`. This file is necessary for the correct rendering of the space panorama in the simulation.

```bash
unzip src/images/spacePanorama-caspianSea.exr.zip -d src/images/
```

Ensure that you have a zip utility installed on your system to execute the unzip command.

## Usage

The project includes scripts for development and production environments:

- **Development**: Run `npm start` to start the development server. Your default web browser will open the project automatically.
- **Production**: Run `npm run build` to create a production build. The output will be located in the `dist` directory.

## Contributing

Contributions are welcome. If you have any improvements or encounter any issues, feel free to create a pull request or open an issue.

## Author

Joao Montenegro

## License

This project is licensed under the ISC License. See the LICENSE file for more details.
