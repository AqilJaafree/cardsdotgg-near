//! Onchain SVG deck card: tier-coloured frame, asset icon, name and stats. Port of contracts/src/SvgRenderer.sol.
use crate::card_data;

pub fn tier_name(tier: u8) -> &'static str {
    match tier {
        0 => "Guardian",
        1 => "Balanced",
        _ => "Degen",
    }
}

fn color(tier: u8) -> &'static str {
    match tier {
        0 => "#3b82f6",
        1 => "#d9a441",
        _ => "#ef4444",
    }
}

fn icon(near: bool) -> &'static str {
    if near {
        r##"<circle cx="356" cy="40" r="16" fill="#00ec97"/><circle cx="356" cy="40" r="6" fill="#18181b"/>"##
    } else {
        r##"<circle cx="356" cy="40" r="16" fill="#22c55e"/>"##
    }
}

pub fn render(deck_id: u64, tier: u8, near: bool, retired: bool) -> String {
    let mut svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><style>.t{{font:700 22px sans-serif;fill:#fff}}.m{{font:12px sans-serif;fill:#a1a1aa}}.n{{font:14px sans-serif;fill:#fff}}.s{{font:12px monospace;fill:#d4d4d8}}</style><rect width="400" height="400" rx="20" fill="#18181b"/><rect x="6" y="6" width="388" height="388" rx="16" fill="none" stroke-width="6" stroke="{}"/>{}"##,
        color(tier),
        icon(near)
    );
    let unit = if retired { " retired" } else if near { " tNEAR" } else { " tUSD" };
    svg.push_str(&format!(
        r##"<text x="24" y="46" class="t">{} Deck</text><text x="24" y="70" class="m">#{}{}</text><text x="376" y="84" class="m" text-anchor="end">HP / ATK / DEF / SPD</text>"##,
        tier_name(tier),
        deck_id,
        unit
    ));
    for i in 0..8u8 {
        let id = tier * 8 + i;
        let (hp, atk, def, spd) = card_data::stats(id);
        let y = 116 + i as u32 * 36;
        svg.push_str(&format!(
            r##"<text x="24" y="{y}" class="n">{}</text><text x="376" y="{y}" class="s" text-anchor="end">{hp} / {atk} / {def} / {spd}</text>"##,
            card_data::NAMES[id as usize]
        ));
    }
    svg.push_str("</svg>");
    svg
}
