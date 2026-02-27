{
  description = "Bookmark RAG Extension development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      perSystem = flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        commonPackages = with pkgs; [
          nodejs_22
          deno
          chromium
          firefox
          wrangler
          xvfb-run
          zip
        ];

        version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

        # Use buildNpmPackage which handles npm dependencies properly
        buildExtension = target: pkgs.buildNpmPackage {
          pname = "bookmark-rag-${target}";
          inherit version;
          
          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              let baseName = builtins.baseNameOf path; in
              !(builtins.elem baseName [ "node_modules" "dist-chrome" "dist-firefox" "dist-web" "coverage" ".git" "screenshots" ]);
          };

          npmDepsHash = "sha256-KBUdTAWoeg3uLB498Ke4fUPPaqgT03I9gzRbihKiAOE=";

          nativeBuildInputs = with pkgs; [ nodejs_22 zip ];

          # npm ci is run automatically by buildNpmPackage
          # Set HOME for vite/postcss which may need cache directories
          preBuild = ''
            export HOME=$TMPDIR
          '';

          buildPhase = ''
            runHook preBuild
            npm run build:${target}
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r dist-${target}/* $out/
            cd $out && ${pkgs.zip}/bin/zip -r $out/bookmark-rag-${target}.zip .
            runHook postInstall
          '';

          # Don't run tests during package build
          doCheck = false;
          
          # buildNpmPackage defaults
          dontNpmBuild = true;
        };

        # E2E walkthrough test (matrix of browser × server)
        runE2EWalkthrough = pkgs.writeShellScriptBin "run-e2e-walkthrough" ''
          set -e

          export BROWSER_PATH="${pkgs.chromium}/bin/chromium"
          export FIREFOX_PATH="${pkgs.firefox}/bin/firefox"
          export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
          export NODE_ENV=development
          export OPENAI_API_KEY="''${OPENAI_API_KEY:-test-key-for-mock}"
          export WRANGLER_SEND_METRICS=false
          export PATH="${pkgs.nodejs_22}/bin:${pkgs.deno}/bin:${pkgs.wrangler}/bin:${pkgs.zip}/bin:$PATH"

          if [ ! -f "package.json" ]; then
            echo "Error: Must be run from the bookmarks project root directory"
            exit 1
          fi

          if [ ! -d "node_modules" ]; then
            echo "Installing npm dependencies..."
            NODE_ENV=development npm install
          fi

          # Build extensions if needed
          if [ ! -d "dist-chrome" ]; then
            echo "Building Chrome extension..."
            npx vite build --config vite.config.chrome.ts
          fi

          if [ ! -d "dist-firefox" ]; then
            echo "Building Firefox extension..."
            npx vite build --config vite.config.firefox.ts
          fi

          # Install server dependencies for wrangler
          if [ -d "server" ] && [ ! -d "server/node_modules" ]; then
            echo "Installing server npm dependencies..."
            (cd server && npm install)
          fi

          echo "Running E2E walkthrough test matrix..."
          ${pkgs.xvfb-run}/bin/xvfb-run \
            --auto-servernum \
            --server-args="-screen 0 1920x1080x24" \
            npx tsx tests/e2e-walkthrough.test.ts
        '';

        # Deno server
        runServer = pkgs.writeShellScriptBin "run-server" ''
          set -e
          export PATH="${pkgs.deno}/bin:$PATH"

          if [ -d "server" ]; then
            cd server
          fi

          if [ ! -f "deno.json" ]; then
            echo "Error: Must be run from bookmarks project root or server directory"
            exit 1
          fi

          echo "Starting Bookmark RAG server..."
          deno task start
        '';

        # Deno server (dev mode with watch)
        runServerDev = pkgs.writeShellScriptBin "run-server-dev" ''
          set -e
          export PATH="${pkgs.deno}/bin:$PATH"

          if [ -d "server" ]; then
            cd server
          fi

          if [ ! -f "deno.json" ]; then
            echo "Error: Must be run from bookmarks project root or server directory"
            exit 1
          fi

          echo "Starting Bookmark RAG server in dev mode..."
          deno task dev
        '';

        # Cloudflare Worker (local dev)
        runWorkerDev = pkgs.writeShellScriptBin "run-worker-dev" ''
          set -e
          export PATH="${pkgs.nodejs_22}/bin:${pkgs.wrangler}/bin:$PATH"
          export WRANGLER_SEND_METRICS=false

          if [ -d "server" ]; then
            cd server
          fi

          if [ ! -f "wrangler.toml" ]; then
            echo "Error: Must be run from bookmarks project root or server directory"
            exit 1
          fi

          if [ ! -d "node_modules" ]; then
            echo "Installing server npm dependencies..."
            npm install
          fi

          if [ ! -d ".wrangler/state" ]; then
            echo "Running D1 migrations..."
            wrangler d1 execute bookmark-rag --local --file=./migrations/0001_initial.sql
          fi

          echo "Starting Cloudflare Worker at http://localhost:8787"
          OPENAI_API_KEY="''${OPENAI_API_KEY:-}" \
          wrangler dev --local --persist-to=.wrangler/state
        '';

        # Common E2E test setup
        e2eTestSetup = ''
          set -e

          export BROWSER_PATH="${pkgs.chromium}/bin/chromium"
          export FIREFOX_PATH="${pkgs.firefox}/bin/firefox"
          export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
          export NODE_ENV=development
          export OPENAI_API_KEY="''${OPENAI_API_KEY:-test-key-for-mock}"
          export WRANGLER_SEND_METRICS=false
          export PATH="${pkgs.nodejs_22}/bin:${pkgs.deno}/bin:${pkgs.wrangler}/bin:${pkgs.zip}/bin:$PATH"

          if [ ! -f "package.json" ]; then
            echo "Error: Must be run from the bookmarks project root directory"
            exit 1
          fi

          if [ ! -d "node_modules" ]; then
            echo "Installing npm dependencies..."
            NODE_ENV=development npm install
          fi

          if [ ! -d "dist-chrome" ]; then
            echo "Building Chrome extension..."
            npx vite build --config vite.config.chrome.ts
          fi

          if [ -d "server" ] && [ ! -d "server/node_modules" ]; then
            echo "Installing server npm dependencies..."
            (cd server && npm install)
          fi
        '';

        # E2E tests with Deno server only
        runE2EServerDeno = pkgs.writeShellScriptBin "run-e2e-server-deno" ''
          ${e2eTestSetup}

          echo "Running E2E tests with Deno server..."
          export SKIP_FIREFOX=1
          export SKIP_WRANGLER=1
          ${pkgs.xvfb-run}/bin/xvfb-run \
            --auto-servernum \
            --server-args="-screen 0 1920x1080x24" \
            npx tsx tests/e2e-walkthrough.test.ts
        '';

        # E2E tests with Wrangler/Worker server only
        runE2EServerWorker = pkgs.writeShellScriptBin "run-e2e-server-worker" ''
          ${e2eTestSetup}

          echo "Running E2E tests with Cloudflare Worker..."
          export SKIP_FIREFOX=1
          export SKIP_DENO=1
          ${pkgs.xvfb-run}/bin/xvfb-run \
            --auto-servernum \
            --server-args="-screen 0 1920x1080x24" \
            npx tsx tests/e2e-walkthrough.test.ts
        '';

        # Run all E2E tests (full matrix)
        runE2EAll = pkgs.writeShellScriptBin "run-e2e-all" ''
          ${e2eTestSetup}

          if [ ! -d "dist-firefox" ]; then
            echo "Building Firefox extension..."
            npx vite build --config vite.config.firefox.ts
          fi

          echo "Running full E2E test matrix (Chrome+Firefox × Deno+Wrangler)..."
          ${pkgs.xvfb-run}/bin/xvfb-run \
            --auto-servernum \
            --server-args="-screen 0 1920x1080x24" \
            npx tsx tests/e2e-walkthrough.test.ts
        '';

      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = commonPackages;

          shellHook = ''
            export BROWSER_PATH="${pkgs.chromium}/bin/chromium"
            export FIREFOX_PATH="${pkgs.firefox}/bin/firefox"
            export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
            export WRANGLER_SEND_METRICS=false

            echo "========================================"
            echo "Bookmark RAG Extension Dev Environment"
            echo "========================================"
            echo ""
            echo "Tools: node $(node --version), deno $(deno --version | head -1)"
            echo ""
            echo "Servers:"
            echo "  nix run .#server-dev  - Start Deno server (dev mode)"
            echo "  nix run .#worker-dev  - Start Cloudflare Worker locally"
            echo ""
            echo "E2E Tests:"
            echo "  nix run .#test-e2e-server-deno   - Chrome + Deno"
            echo "  nix run .#test-e2e-server-worker - Chrome + Worker"
            echo "  nix run .#test-e2e-all           - Full matrix"
            echo ""
          '';
        };

        packages = {
          chrome = buildExtension "chrome";
          firefox = buildExtension "firefox";
          server-vendor = pkgs.callPackage ./nix/server-vendor.nix { };
          server = pkgs.callPackage ./nix/server-package.nix {
            serverVendor = self.packages.${system}.server-vendor;
          };
          default = buildExtension "firefox";
        };

        apps = {
          test = {
            type = "app";
            program = "${runE2EWalkthrough}/bin/run-e2e-walkthrough";
          };

          server = {
            type = "app";
            program = "${runServer}/bin/run-server";
          };

          server-dev = {
            type = "app";
            program = "${runServerDev}/bin/run-server-dev";
          };

          worker-dev = {
            type = "app";
            program = "${runWorkerDev}/bin/run-worker-dev";
          };

          test-e2e-server-deno = {
            type = "app";
            program = "${runE2EServerDeno}/bin/run-e2e-server-deno";
          };

          test-e2e-server-worker = {
            type = "app";
            program = "${runE2EServerWorker}/bin/run-e2e-server-worker";
          };

          test-e2e-all = {
            type = "app";
            program = "${runE2EAll}/bin/run-e2e-all";
          };
        };
      }
    );
    in
      perSystem // {
        nixosModules.default = import ./nix/module.nix;
      };
}
