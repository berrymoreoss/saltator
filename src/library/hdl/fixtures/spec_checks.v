// A D flip-flop with set and reset and its timing checks (HDL-2): set-up and hold armed while
// neither set nor reset holds it (`&&&`), set-up/hold, recovery, removal, and pulse widths as a
// `$hold` between opposite edges of one pin (Yosys reads no `$width`).
module spec_checks (
    input cp,
    input d,
    input sdn,
    input rdn,
    output reg q
);
  always @(posedge cp or negedge sdn or negedge rdn)
    if (!rdn) q <= 0;
    else if (!sdn) q <= 1;
    else q <= d;
  specify
    (posedge cp => (q +: d)) = 17;
    (sdn => q) = 18;
    (rdn => q) = 19;
    $setup(d, posedge cp &&& (sdn & rdn), 15);
    $hold(posedge cp &&& (sdn & rdn), d, 3);
    $setuphold(posedge cp, d, 12, 4);
    $recovery(posedge rdn, posedge cp, 8);
    $removal(posedge sdn, posedge cp, 2);
    $hold(posedge cp &&& (sdn & rdn), negedge cp, 20);
    $hold(negedge cp &&& (sdn & rdn), posedge cp, 20);
    $hold(negedge sdn, posedge sdn, 20);
  endspecify
endmodule
