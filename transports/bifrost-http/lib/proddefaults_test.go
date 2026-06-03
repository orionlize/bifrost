package lib

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/maximhq/bifrost/plugins/semanticcache"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyProductionDefaults_OutsideProduction(t *testing.T) {
	t.Setenv(productionEnvKey, "development")

	var configData ConfigData
	applyProductionDefaults(&configData)

	assert.Nil(t, configData.VectorStoreConfig)
	assert.Empty(t, configData.Plugins)
}

func TestApplyProductionDefaults_InProductionWithoutRedisEnv(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "")

	var configData ConfigData
	applyProductionDefaults(&configData)

	assert.Nil(t, configData.VectorStoreConfig)
	assert.Empty(t, configData.Plugins)
}

func TestApplyProductionDefaults_InProductionWithRedisEnv(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "ai-redis-ytykne:6379")
	t.Setenv(productionRedisUsernameEnv, "default")
	t.Setenv(productionRedisPasswordEnv, "secret")

	var configData ConfigData
	applyProductionDefaults(&configData)

	require.NotNil(t, configData.VectorStoreConfig)
	assert.True(t, configData.VectorStoreConfig.Enabled)
	assert.Equal(t, vectorstore.VectorStoreTypeRedis, configData.VectorStoreConfig.Type)

	redisConfig, ok := configData.VectorStoreConfig.Config.(vectorstore.RedisConfig)
	require.True(t, ok)
	assert.Equal(t, "ai-redis-ytykne:6379", redisConfig.Addr.GetValue())
	assert.Equal(t, "default", redisConfig.Username.GetValue())
	assert.Equal(t, "secret", redisConfig.Password.GetValue())
	assert.True(t, redisConfig.Addr.FromEnv)
	assert.Equal(t, "env."+productionRedisAddrEnv, redisConfig.Addr.EnvVar)

	require.Len(t, configData.Plugins, 1)
	assert.Equal(t, semanticcache.PluginName, configData.Plugins[0].Name)
	assert.True(t, configData.Plugins[0].Enabled)

	pluginConfig, ok := configData.Plugins[0].Config.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 1, pluginConfig["dimension"])
	assert.Equal(t, 300, pluginConfig["ttl"])
	assert.Equal(t, 0.8, pluginConfig["threshold"])
	assert.Equal(t, productionSemanticCacheDefaultKeyVal, pluginConfig["default_cache_key"])
	assert.Equal(t, productionSemanticCacheDefaultNS, pluginConfig["vector_store_namespace"])
}

func TestApplyProductionDefaults_SemanticCacheEnvOverrides(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "valkey:6379")
	t.Setenv(productionSemanticCacheTTLEnv, "600")
	t.Setenv(productionSemanticCacheThresholdEnv, "0.9")
	t.Setenv(productionSemanticCacheNamespaceEnv, "custom-ns")
	t.Setenv(productionSemanticCacheDefaultKeyEnv, "custom-key")

	var configData ConfigData
	applyProductionDefaults(&configData)

	require.Len(t, configData.Plugins, 1)
	pluginConfig, ok := configData.Plugins[0].Config.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 600, pluginConfig["ttl"])
	assert.Equal(t, 0.9, pluginConfig["threshold"])
	assert.Equal(t, "custom-ns", pluginConfig["vector_store_namespace"])
	assert.Equal(t, "custom-key", pluginConfig["default_cache_key"])
}

func TestApplyProductionDefaults_SemanticCacheDisabled(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "valkey:6379")
	t.Setenv(productionSemanticCacheEnabledEnv, "false")

	var configData ConfigData
	applyProductionDefaults(&configData)

	require.NotNil(t, configData.VectorStoreConfig)
	assert.Empty(t, configData.Plugins)
}

func TestApplyProductionDefaults_RespectsExistingVectorStore(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "ai-redis-ytykne:6379")

	configData := ConfigData{
		VectorStoreConfig: &vectorstore.Config{
			Enabled: true,
			Type:    vectorstore.VectorStoreTypeWeaviate,
		},
	}
	applyProductionDefaults(&configData)

	assert.Equal(t, vectorstore.VectorStoreTypeWeaviate, configData.VectorStoreConfig.Type)
	require.Len(t, configData.Plugins, 1)
	assert.Equal(t, semanticcache.PluginName, configData.Plugins[0].Name)
}

func TestApplyProductionDefaults_RespectsExistingSemanticCachePlugin(t *testing.T) {
	t.Setenv(productionEnvKey, productionEnvValue)
	t.Setenv(productionRedisAddrEnv, "valkey:6379")

	configData := ConfigData{
		Plugins: []*schemas.PluginConfig{
			{
				Name:    semanticcache.PluginName,
				Enabled: true,
				Config: map[string]interface{}{
					"dimension": 1,
					"ttl":       120,
				},
			},
		},
	}
	applyProductionDefaults(&configData)

	require.Len(t, configData.Plugins, 1)
	pluginConfig, ok := configData.Plugins[0].Config.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 120, pluginConfig["ttl"])
}
