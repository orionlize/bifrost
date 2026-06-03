package lib

import (
	"os"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/vectorstore"
)

const (
	productionEnvKey   = "BIFROST_ENV"
	productionEnvValue = "production"
)

func isProductionRuntime() bool {
	return os.Getenv(productionEnvKey) == productionEnvValue
}

// applyProductionDefaults injects runtime defaults that should only apply in production
// deployments (for example Docker prod images with BIFROST_ENV=production).
func applyProductionDefaults(configData *ConfigData) {
	if !isProductionRuntime() {
		return
	}
	if configData.VectorStoreConfig != nil && configData.VectorStoreConfig.Enabled {
		logger.Info("vector store already configured; skipping production vector store defaults")
		return
	}
	configData.VectorStoreConfig = productionRedisVectorStoreConfig()
	logger.Info("applied production vector store defaults (redis)")
}

func productionRedisVectorStoreConfig() *vectorstore.Config {
	falseVar := schemas.NewEnvVar("false")
	return &vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypeRedis,
		Config: vectorstore.RedisConfig{
			Addr:               schemas.NewEnvVar("ai-redis-ytykne:6379"),
			Username:           schemas.NewEnvVar("default"),
			Password:           schemas.NewEnvVar("m1cluppekwypk8gq"),
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
