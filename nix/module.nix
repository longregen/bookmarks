{ config, lib, pkgs, ... }:

let
  cfg = config.services.bookmark-rag;
in
{
  options.services.bookmark-rag = {
    enable = lib.mkEnableOption "Bookmark RAG Deno server";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The bookmark-rag server source package.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Port to listen on.";
    };

    corsOrigin = lib.mkOption {
      type = lib.types.str;
      default = "*";
      description = "CORS origin header value.";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/bookmark-rag";
      description = "Directory for database and cache files.";
    };

    openaiApiBase = lib.mkOption {
      type = lib.types.str;
      default = "https://api.openai.com/v1";
      description = "Base URL for the OpenAI-compatible API.";
    };

    embeddingModel = lib.mkOption {
      type = lib.types.str;
      default = "text-embedding-3-small";
      description = "Embedding model name.";
    };

    chatModel = lib.mkOption {
      type = lib.types.str;
      default = "gpt-4o-mini";
      description = "Chat model name.";
    };

    sessionDurationMs = lib.mkOption {
      type = lib.types.nullOr lib.types.int;
      default = null;
      description = "Session duration in milliseconds. Null uses the server default.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to an environment file containing secrets (e.g. OPENAI_API_KEY).
        This file is never copied into the Nix store.
      '';
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to open the firewall for the server port.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.bookmark-rag = {
      description = "Bookmark RAG Deno Server";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];

      environment = {
        PORT = toString cfg.port;
        CORS_ORIGIN = cfg.corsOrigin;
        DATABASE_PATH = "${cfg.dataDir}/bookmarks.db";
        DENO_DIR = "${cfg.dataDir}/.cache/deno";
        OPENAI_API_BASE = cfg.openaiApiBase;
        EMBEDDING_MODEL = cfg.embeddingModel;
        CHAT_MODEL = cfg.chatModel;
      } // lib.optionalAttrs (cfg.sessionDurationMs != null) {
        SESSION_DURATION_MS = toString cfg.sessionDurationMs;
      };

      serviceConfig = {
        Type = "simple";
        ExecStart = lib.concatStringsSep " " [
          "${pkgs.deno}/bin/deno"
          "run"
          "--allow-net"
          "--allow-read"
          "--allow-write"
          "--allow-env"
          "--allow-ffi"
          "--unstable-ffi"
          "${cfg.package}/src/main.ts"
        ];
        Restart = "on-failure";
        RestartSec = 5;

        DynamicUser = true;
        StateDirectory = "bookmark-rag";
        WorkingDirectory = "${cfg.package}/src";
      } // lib.optionalAttrs (cfg.environmentFile != null) {
        EnvironmentFile = cfg.environmentFile;
      } // {
        # Hardening
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
        RestrictNamespaces = true;
        LockPersonality = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        # V8 JIT requires W+X pages
        MemoryDenyWriteExecute = false;
        SystemCallArchitectures = "native";
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
