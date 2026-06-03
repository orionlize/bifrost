package lib

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/maximhq/bifrost/plugins/semanticcache"
)

const (
	productionEnvKey   = "BIFROST_ENV"
	productionEnvValue = "production"

	productionRedisAddrEnv     = "BIFROST_REDIS_ADDR"
	productionRedisUsernameEnv = "BIFROST_REDIS_USERNAME"
	productionRedisPasswordEnv = "BIFROST_REDIS_PASSWORD"

	productionSemanticCacheEnabledEnv     = "BIFROST_SEMANTIC_CACHE_ENABLED"
	productionSemanticCacheTTLEnv         = "BIFROST_SEMANTIC_CACHE_TTL"
	productionSemanticCacheThresholdEnv   = "BIFROST_SEMANTIC_CACHE_THRESHOLD"
	productionSemanticCacheNamespaceEnv   = "BIFROST_SEMANTIC_CACHE_NAMESPACE"
	productionSemanticCacheDefaultKeyEnv  = "BIFROST_SEMANTIC_CACHE_DEFAULT_KEY"
	productionSemanticCacheDefaultTTL     = 300
	productionSemanticCacheDefaultThresh  = 0.8
	productionSemanticCacheDefaultNS      = "bifrost_semantic_cache"
	productionSemanticCacheDefaultKeyVal = "bifrost-default"
)

func isProductionRuntime() bool {
	return os.Getenv(productionEnvKey) == productionEnvValue
}

func productionSemanticCacheEnabled() bool {
	value := strings.TrimSpace(os.Getenv(productionSemanticCacheEnabledEnv))
	if value == "" {
		return true
	}
	switch strings.ToLower(value) {
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

func vectorStoreEnabled(configData *ConfigData) bool {
	return configData.VectorStoreConfig != nil && configData.VectorStoreConfig.Enabled
}

func hasPlugin(plugins []*schemas.PluginConfig, name string) bool {
	for _, plugin := range plugins {
		if plugin != nil && plugin.Name == name {
			return true
		}
	}
	return false
}

// applyProductionDefaults injects runtime defaults that should only apply in production
// deployments (for example Docker prod images with BIFROST_ENV=production).
func applyProductionDefaults(configData *ConfigData) {
	if !isProductionRuntime() {
		return
	}

	redisAddrSet := os.Getenv(productionRedisAddrEnv) != ""
	if !vectorStoreEnabled(configData) {
		if !redisAddrSet {
			logger.Info("%s not set; skipping production vector store defaults", productionRedisAddrEnv)
		} else {
			configData.VectorStoreConfig = productionRedisVectorStoreConfig()
			logger.Info("applied production vector store defaults (redis)")
		}
	} else {
		logger.Info("vector store already configured; skipping production vector store defaults")
	}

	if productionSemanticCacheEnabled() && vectorStoreEnabled(configData) {
		applyProductionSemanticCacheDefaults(configData)
	}
}

func applyProductionSemanticCacheDefaults(configData *ConfigData) {
	if hasPlugin(configData.Plugins, semanticcache.PluginName) {
		logger.Info("semantic_cache plugin already configured; skipping production defaults")
		return
	}

	configData.Plugins = append(configData.Plugins, productionSemanticCachePlugin())
	logger.Info("applied production semantic_cache plugin defaults (valkey/redis direct-hash mode)")
}

func productionSemanticCachePlugin() *schemas.PluginConfig {
	return &schemas.PluginConfig{
		Name:    semanticcache.PluginName,
		Enabled: true,
		Config: map[string]interface{}{
			"dimension":              1,
			"ttl":                      productionSemanticCacheTTL(),
			"threshold":                productionSemanticCacheThreshold(),
			"default_cache_key":        productionSemanticCacheDefaultKey(),
			"vector_store_namespace":   productionSemanticCacheNamespace(),
		},
	}
}

func productionSemanticCacheTTL() int {
	return envIntOrDefault(productionSemanticCacheTTLEnv, productionSemanticCacheDefaultTTL)
}

func productionSemanticCacheThreshold() float64 {
	return envFloatOrDefault(productionSemanticCacheThresholdEnv, productionSemanticCacheDefaultThresh)
}

func productionSemanticCacheNamespace() string {
	value := strings.TrimSpace(os.Getenv(productionSemanticCacheNamespaceEnv))
	if value == "" {
		return productionSemanticCacheDefaultNS
	}
	return value
}

func productionSemanticCacheDefaultKey() string {
	value := strings.TrimSpace(os.Getenv(productionSemanticCacheDefaultKeyEnv))
	if value == "" {
		return productionSemanticCacheDefaultKeyVal
	}
	return value
}

func envIntOrDefault(key string, defaultVal int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return defaultVal
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return defaultVal
	}
	return parsed
}

func envFloatOrDefault(key string, defaultVal float64) float64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return defaultVal
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return defaultVal
	}
	return parsed
}

func productionRedisVectorStoreConfig() *vectorstore.Config {
	falseVar := schemas.NewEnvVar("false")
	return &vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypeRedis,
		Config: vectorstore.RedisConfig{
			Addr:               schemas.NewEnvVar("env." + productionRedisAddrEnv),
			Username:           schemas.NewEnvVar("env." + productionRedisUsernameEnv),
			Password:           schemas.NewEnvVar("env." + productionRedisPasswordEnv),
			DB:                 schemas.NewEnvVar("0"),
			UseTLS:             falseVar,
			InsecureSkipVerify: falseVar,
			ClusterMode:        falseVar,
			PoolSize:           10,
			MaxActiveConns:     10,
			MinIdleConns:       5,
			MaxIdleConns:       10,
			DialTimeout:        schemas.Duration(5 * time.Second),
			ReadTimeout:        schemas.Duration(3 * time.Second),
			WriteTimeout:       schemas.Duration(3 * time.Second),
			ContextTimeout:     schemas.Duration(10 * time.Second),
		},
	}
}
