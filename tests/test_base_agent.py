"""Tests fuer BaseAgent, AgentConfig und Datenklassen.

Validiert:
- Enums und Datenklassen korrekt definiert
- AgentMessage Serialisierung / Deserialisierung
- AgentConfig Defaults
- BaseAgent kann nicht direkt instanziiert werden (ABC)
- Cost Tracking korrekt
"""

import pytest
from agents.base_agent import (
    AgentConfig,
    AgentMessage,
    AgentTier,
    BaseAgent,
    MessagePriority,
    MessageType,
)


class TestEnums:
    def test_agent_tiers(self):
        assert AgentTier.BRAIN.value == 0
        assert AgentTier.C_SUITE.value == 1
        assert AgentTier.DIRECTOR.value == 2
        assert AgentTier.OPERATOR.value == 3

    def test_message_priorities(self):
        assert MessagePriority.CRITICAL.value == "critical"
        assert MessagePriority.HIGH.value == "high"
        assert MessagePriority.NORMAL.value == "normal"
        assert MessagePriority.LOW.value == "low"

    def test_message_types_complete(self):
        expected = {
            "intelligence_briefing", "task_request", "task_result",
            "status_update", "alert", "decision_request", "decision",
            "legal_review_request", "legal_review_result",
            "content_draft", "content_approved", "revenue_update",
            "health_check", "conflict_resolution",
        }
        actual = {mt.value for mt in MessageType}
        assert actual == expected


class TestAgentConfig:
    def test_defaults(self):
        cfg = AgentConfig(name="test", role="Tester", tier=AgentTier.OPERATOR)
        # Commit d9f430a (10.07.2026): Retired Model-ID claude-sonnet-4-20250514 → claude-sonnet-5.
        assert cfg.llm_model == "claude-sonnet-5"
        assert cfg.max_tokens == 4096
        assert cfg.temperature == 0.3
        assert cfg.channels == []
        assert cfg.tools == []
        assert cfg.knowledge_tags == []

    def test_custom_values(self):
        cfg = AgentConfig(
            name="treasurer",
            role="CFO",
            tier=AgentTier.C_SUITE,
            llm_model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            temperature=0.1,
            channels=["#revenue"],
            tools=["calculator"],
            knowledge_tags=["finance"],
        )
        assert cfg.name == "treasurer"
        assert "haiku" in cfg.llm_model
        assert cfg.max_tokens == 2048


class TestAgentMessage:
    def test_auto_id(self):
        msg = AgentMessage(from_agent="oracle")
        assert msg.id.startswith("msg_")
        assert len(msg.id) > 10

    def test_serialization_roundtrip(self):
        msg = AgentMessage(
            from_agent="oracle",
            from_role="CIO",
            to_channels=["#market-intel"],
            to_agents=["publisher"],
            message_type=MessageType.INTELLIGENCE_BRIEFING,
            priority=MessagePriority.HIGH,
            content={"briefing": "test content"},
            confidence=0.85,
        )
        serialized = msg.to_dict()
        assert serialized["from_agent"] == "oracle"
        assert serialized["message_type"] == "intelligence_briefing"
        assert serialized["priority"] == "high"

        restored = AgentMessage.from_dict(serialized)
        assert restored.from_agent == "oracle"
        assert restored.message_type == MessageType.INTELLIGENCE_BRIEFING
        assert restored.confidence == 0.85

    def test_content_und_metadata_als_objekte(self):
        """Gegencheck 06.11.2026: JSONB-Spalten bekommen Objekte, keinen JSON-Text."""
        msg = AgentMessage(from_agent="oracle", content={"text": "Hallo"}, metadata={"source": "test"})
        serialized = msg.to_dict()
        assert serialized["content"] == {"text": "Hallo"}
        assert serialized["metadata"] == {"source": "test"}
        restored = AgentMessage.from_dict(serialized)
        assert restored.content == {"text": "Hallo"}
        assert restored.metadata == {"source": "test"}

    def test_altform_als_json_text_bleibt_lesbar(self):
        """Zeilen von vor dem Fix (content/metadata als JSON-Text) liest from_dict weiter."""
        alt = AgentMessage(from_agent="oracle").to_dict()
        alt["content"] = '{"text": "Hallo"}'
        alt["metadata"] = '{"source": "test"}'
        restored = AgentMessage.from_dict(alt)
        assert restored.content == {"text": "Hallo"}
        assert restored.metadata == {"source": "test"}

    def test_defaults(self):
        msg = AgentMessage()
        assert msg.priority == MessagePriority.NORMAL
        assert msg.message_type == MessageType.STATUS_UPDATE
        assert msg.requires_legal_review is False
        assert msg.confidence == 0.0


class TestBaseAgentABC:
    def test_cannot_instantiate_directly(self, mock_anthropic, no_supabase):
        """BaseAgent ist abstrakt — direkte Instanziierung muss fehlschlagen."""
        with pytest.raises(TypeError, match="abstract"):
            BaseAgent(AgentConfig(name="test", role="Test", tier=AgentTier.OPERATOR))

    def test_cost_calculation(self, mock_anthropic, no_supabase):
        """Cost Tracking: Sonnet vs Haiku Preise."""

        class DummyAgent(BaseAgent):
            async def execute(self, task, **kwargs):
                return {"status": "success", "output": "dummy"}

        agent = DummyAgent(AgentConfig(
            name="dummy", role="Test", tier=AgentTier.OPERATOR,
            llm_model="claude-sonnet-4-20250514",
        ))

        # Sonnet: $3/M input, $15/M output
        cost = agent._calculate_cost(1000, 500)
        expected = (1000 * 3.0 / 1_000_000) + (500 * 15.0 / 1_000_000)
        assert abs(cost - expected) < 0.0001

    def test_cost_calculation_haiku(self, mock_anthropic, no_supabase):
        class DummyAgent(BaseAgent):
            async def execute(self, task, **kwargs):
                return {"status": "success", "output": "dummy"}

        agent = DummyAgent(AgentConfig(
            name="dummy", role="Test", tier=AgentTier.OPERATOR,
            llm_model="claude-haiku-4-5-20251001",
        ))

        # Haiku: $0.25/M input, $1.25/M output
        cost = agent._calculate_cost(1000, 500)
        expected = (1000 * 0.25 / 1_000_000) + (500 * 1.25 / 1_000_000)
        assert abs(cost - expected) < 0.0001

    def test_cost_tracking_cumulative(self, mock_anthropic, no_supabase):
        class DummyAgent(BaseAgent):
            async def execute(self, task, **kwargs):
                return {"status": "success", "output": "dummy"}

        agent = DummyAgent(AgentConfig(
            name="dummy", role="Test", tier=AgentTier.OPERATOR,
        ))

        agent._track_cost(100, 50)
        agent._track_cost(200, 100)
        assert agent._total_input_tokens == 300
        assert agent._total_output_tokens == 150
        assert agent._total_cost_usd > 0

    def test_health_check(self, mock_anthropic, no_supabase):
        class DummyAgent(BaseAgent):
            async def execute(self, task, **kwargs):
                return {"status": "success", "output": "dummy"}

        agent = DummyAgent(AgentConfig(
            name="dummy", role="Test", tier=AgentTier.OPERATOR,
        ))

        import asyncio
        status = asyncio.run(agent.health_check())
        assert status["agent"] == "dummy"
        assert status["status"] == "online"
        assert "total_cost_usd" in status
